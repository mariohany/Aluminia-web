import { Injectable, Logger } from '@nestjs/common';
import type { ReportLanguage, ReportProgressGroup } from '@repo/types/reports';
import { MEMBER_ORDER, profileQueue } from '@repo/bar-optimiser/project';
import {
  validateSolve,
  type SolveResult,
} from '@repo/bar-optimiser/solve-result';
import { ReportCache } from '../../database/tenant/entities/report-cache.entity';
import { TenantConnectionService } from '../tenancy/tenant-connection.service';
import { FilesService } from '../files/files.service';
import { PdfRenderer } from './pdf/pdf-renderer.service';
import { footerTemplate, renderBarOptimiserHtml } from './pdf/template';
import { ReportJobQueue, jobQueueKey } from './report-job-queue';
import {
  profileNoOf,
  summaryOf,
  type ProjectPieces,
  type ReportInputs,
} from './report-inputs';

// The background print of one language's PDF
// (docs/browser_solve_planing.md B7). The solve was made in a browser and
// stored in `report_solve`; the request reserves the cache row and
// returns, and this prints the PDF from that solve and writes it back
// through TenantConnectionService — the request and its
// TenantContextService are long gone by then. A print waits in
// ReportJobQueue for a free Chrome slot first (docs/report_queue_planing.md),
// heartbeating all along so a waiting job isn't taken for a dead one.

/** While a job runs its row is touched this often… */
export const JOB_HEARTBEAT_MS = 15_000;
/** …so a `running` row silent for longer died with its server. The same
 * limit marks a browser's solve as stopped (B5). */
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
  /** The print fingerprint of this language's PDF. */
  fingerprint: string;
  inputs: ReportInputs;
  pieces: ProjectPieces;
  /** The project's stored solve, made for these inputs. */
  solve: SolveResult;
}

/** One line per member group that has pieces, all waiting: a new solve's
 * progress (B5). */
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

  constructor(
    private readonly connection: TenantConnectionService,
    private readonly pdfRenderer: PdfRenderer,
    private readonly queue: ReportJobQueue,
    private readonly files: FilesService,
  ) {}

  /** Fire and forget: the job waits for a slot, then prints; failures
   * land on the row as `job_state = failed`. */
  start(job: ReportJob): void {
    void this.run(job);
  }

  private async run(job: ReportJob): Promise<void> {
    // Writes go out one after another, in order.
    let writes: Promise<unknown> = Promise.resolve();
    const persist = (patch: Partial<ReportCache>) => {
      writes = writes
        .then(() => this.update(job, patch))
        .catch((error: unknown) =>
          this.logger.warn(`Report job write failed: ${String(error)}`),
        );
    };
    const heartbeat = setInterval(() => persist({}), JOB_HEARTBEAT_MS);
    heartbeat.unref();

    // Settles when the job's turn has come and gone.
    await new Promise<void>((resolve) =>
      this.queue.enqueue(
        jobQueueKey(job.cacheId, job.startedAt),
        () => this.work(job, persist).finally(resolve),
        resolve,
      ),
    );
    clearInterval(heartbeat);
    await writes;
  }

  /** The job's turn: rebuild the plans from the solve, print, store.
   * Never throws. */
  private async work(
    job: ReportJob,
    persist: (patch: Partial<ReportCache>) => void,
  ): Promise<void> {
    persist({ jobState: 'running' });
    try {
      const { settings } = job.inputs;
      // Checked when it was stored; checking again rebuilds the plans with
      // their piece labels, and refuses a solve the inputs have outgrown.
      const result = validateSolve(
        job.pieces.pieces,
        {
          lengths: settings.stockLengthsMm,
          kerfMm: settings.kerfMm,
          endTrimMm: settings.endTrimMm,
        },
        job.solve,
      );
      const summary = summaryOf(job.inputs, job.pieces, result);
      const generatedAt = new Date();
      const { project, letterhead } = job.inputs;
      const arabic = job.language === 'ar';
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
      this.logger.error(`Bar optimiser print failed: ${message}`);
      persist({ jobState: 'failed', jobError: message });
    }
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
