import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ReportKind,
  type BarOptimiserSummary,
  type ReportLanguage,
  type ReportProgressGroup,
} from '@repo/types/reports';
import type { Env } from '../../config/env.schema';
import { ReportCache } from '../../database/tenant/entities/report-cache.entity';
import { ReportSolve } from '../../database/tenant/entities/report-solve.entity';
import { TenantConnectionService } from '../tenancy/tenant-connection.service';
import { MEMBER_ORDER, profileQueue } from '@repo/bar-optimiser/project';
import {
  solveInput,
  solvedProfileOf,
  validateSolve,
  type SolveResult,
} from '@repo/bar-optimiser/solve-result';
import { BarOptimiserRunner } from './bar-optimiser/runner';
import { PdfRenderer } from './pdf/pdf-renderer.service';
import { footerTemplate, renderBarOptimiserHtml } from './pdf/template';
import { FilesService } from '../files/files.service';
import { ReportJobQueue, jobQueueKey } from './report-job-queue';
import {
  profileNoOf,
  summaryOf,
  type ProjectPieces,
  type ReportInputs,
} from './report-inputs';

// The background half of Generate (docs/reports_planing.md §7, D22). The
// request reserves the cache row and returns; this runs the optimiser
// (off the event loop, BarOptimiserRunner) and writes progress, then the
// result, back to that row through TenantConnectionService — the request
// and its TenantContextService are long gone by then. A job waits in
// ReportJobQueue for a free slot first (docs/report_queue_planing.md),
// heartbeating all along so a waiting job isn't taken for a dead one.

/** While a job runs its row is touched this often… */
export const JOB_HEARTBEAT_MS = 15_000;
/** …so a `running` row silent for longer died with its server. */
export const JOB_ORPHANED_AFTER_MS = 60_000;

export interface ReportJob {
  schemaName: string;
  cacheId: string;
  /** Also the row's `job_started_at`: every write is guarded on it, so a
   * job can only ever write its own row state. */
  startedAt: Date;
  userId: string;
  language: ReportLanguage;
  /** Owner of the logo file (the request's resolved tenant). */
  companyId: string;
  /** The account name: the header's name until the company profile is
   * saved (docs/company_profile_planing.md P1). */
  companyName: string;
  projectId: string;
  /** The print fingerprint of this language's PDF. */
  fingerprint: string;
  /** The project's solve fingerprint (docs/browser_solve_planing.md §6). */
  solveFingerprint: string;
  windowStamps: Record<string, string>;
  inputs: ReportInputs;
  pieces: ProjectPieces;
}

/** One line per member group that has pieces, all waiting. */
export function initialProgress(pieces: ProjectPieces): ReportProgressGroup[] {
  const queue = profileQueue(pieces.pieces);
  return MEMBER_ORDER.flatMap((member) => {
    const total = queue.filter((q) => q.member === member).length;
    return total
      ? [
          {
            member,
            state: 'waiting' as const,
            profilesDone: 0,
            profilesTotal: total,
            currentProfile: null,
          },
        ]
      : [];
  });
}

@Injectable()
export class ReportJobService {
  private readonly logger = new Logger(ReportJobService.name);

  private readonly solveTimeoutMs: number;

  constructor(
    private readonly connection: TenantConnectionService,
    private readonly runner: BarOptimiserRunner,
    private readonly pdfRenderer: PdfRenderer,
    private readonly queue: ReportJobQueue,
    private readonly files: FilesService,
    config: ConfigService<Env, true>,
  ) {
    this.solveTimeoutMs =
      config.get('REPORT_SOLVE_TIMEOUT_MINUTES', { infer: true }) * 60_000;
  }

  /** Fire and forget: the job waits for a slot, then runs; failures land
   * on the row as `job_state = failed`. */
  start(job: ReportJob): void {
    void this.run(job);
  }

  private async run(job: ReportJob): Promise<void> {
    const groups = initialProgress(job.pieces);
    // Writes go out one after another, in order.
    let writes: Promise<unknown> = Promise.resolve();
    const persist = (patch: Partial<ReportCache>) => {
      writes = writes
        .then(() => this.update(job, patch))
        .catch((error: unknown) =>
          this.logger.warn(
            `Report job progress write failed: ${String(error)}`,
          ),
        );
    };
    const heartbeat = setInterval(() => persist({}), JOB_HEARTBEAT_MS);
    heartbeat.unref();

    // Settles when the job's turn has come and gone, or when it was
    // cancelled while waiting (C8; the request clears the row).
    await new Promise<void>((resolve) =>
      this.queue.enqueue(
        jobQueueKey(job.cacheId, job.startedAt),
        () => this.work(job, groups, persist).finally(resolve),
        resolve,
      ),
    );
    clearInterval(heartbeat);
    await writes;
  }

  /** The job's turn: solve, print, store. Never throws. */
  private async work(
    job: ReportJob,
    groups: ReturnType<typeof initialProgress>,
    persist: (patch: Partial<ReportCache>) => void,
  ): Promise<void> {
    persist({ jobState: 'running' });
    try {
      const settings = {
        lengths: job.inputs.settings.stockLengthsMm,
        kerfMm: job.inputs.settings.kerfMm,
        endTrimMm: job.inputs.settings.endTrimMm,
      };
      // Solved on line numbers and rebuilt through the same check a
      // browser's plans will get (docs/browser_solve_planing.md §5).
      const solved = await this.runner.run(
        solveInput(job.pieces.pieces),
        settings,
        ({ type, step }) => {
          const group = groups.find((g) => g.member === step.member);
          if (!group) return;
          if (type === 'start') {
            group.state = 'running';
            group.currentProfile =
              profileNoOf(job.inputs, step.profile) ?? step.profile;
          } else {
            group.profilesDone++;
            group.currentProfile = null;
            group.state =
              group.profilesDone >= group.profilesTotal ? 'done' : 'running';
          }
          persist({ jobProgress: { groups: groups.map((g) => ({ ...g })) } });
        },
        this.solveTimeoutMs,
      );
      const solveResult: SolveResult = {
        profiles: solved.profiles.map((p) => solvedProfileOf(p.profile, p)),
      };
      const result = validateSolve(job.pieces.pieces, settings, solveResult);
      const summary = summaryOf(job.inputs, job.pieces, result);
      const generatedAt = new Date();
      await this.storeSolve(job, solveResult, summary, generatedAt);
      const { project } = job.inputs;
      const arabic = job.language === 'ar';
      const { letterhead } = job.inputs;
      const pdf = await this.pdfRenderer.render(
        renderBarOptimiserHtml({
          language: job.language,
          companyName:
            (arabic && letterhead.arName) ||
            letterhead.enName ||
            job.companyName,
          logoDataUri: await this.logoDataUri(job),
          projectName: (arabic && project.arName) || project.enName,
          clientName:
            (arabic && project.client?.arName) || project.client?.enName || '',
          generatedAt,
          summary,
          plans: result.profiles.map((p) => ({
            profile: p.profile,
            profileNo: profileNoOf(job.inputs, p.profile),
            member: p.member,
            best: p.best,
          })),
          panelCounts: Object.fromEntries(
            job.inputs.windows.map((w) => [w.id, w.panels.length]),
          ),
        }),
        footerTemplate(),
      );
      persist({
        fingerprint: job.fingerprint,
        pdf,
        generatedAt,
        generatedByUserId: job.userId,
        jobState: null,
        jobFingerprint: null,
        jobProgress: null,
        jobStartedAt: null,
        jobStartedByUserId: null,
        jobError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bar optimiser report failed: ${message}`);
      persist({ jobState: 'failed', jobError: message });
    }
  }

  /** The project's solve, for every language's PDF (B4). */
  private async storeSolve(
    job: ReportJob,
    result: SolveResult,
    summary: BarOptimiserSummary,
    solvedAt: Date,
  ): Promise<void> {
    await this.connection.runInSchema(job.schemaName, (manager) =>
      manager
        .createQueryBuilder()
        .insert()
        .into(ReportSolve)
        .values({
          projectId: job.projectId,
          reportKind: ReportKind.BAR_OPTIMISER,
          solveFingerprint: job.solveFingerprint,
          windowStamps: job.windowStamps,
          result,
          summary,
          solvedAt,
          solvedByUserId: job.userId,
        })
        .orUpdate(
          [
            'solve_fingerprint',
            'window_stamps',
            'result',
            'summary',
            'solved_at',
            'solved_by_user_id',
            'updated_at',
          ],
          ['project_id', 'report_kind'],
        )
        .execute(),
    );
  }

  /** The company logo as a data URI for the PDF, or null. A logo that
   * can't be read (deleted meanwhile) prints the "A" mark rather than
   * failing the report. */
  private async logoDataUri(job: ReportJob): Promise<string | null> {
    const id = job.inputs.letterhead.logoFileId;
    if (!id) return null;
    try {
      const file = await this.files.read(job.companyId, id);
      return `data:${file.contentType};base64,${file.body.toString('base64')}`;
    } catch (error) {
      this.logger.warn(
        `Report logo ${id} unreadable, printing without it: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async update(
    job: ReportJob,
    patch: Partial<ReportCache>,
  ): Promise<void> {
    await this.connection.runInSchema(job.schemaName, (manager) =>
      manager
        .createQueryBuilder()
        .update(ReportCache)
        .set({ ...patch, updatedAt: () => 'now()' })
        .where('id = :id AND job_started_at = :startedAt', {
          id: job.cacheId,
          startedAt: job.startedAt,
        })
        .execute(),
    );
  }
}
