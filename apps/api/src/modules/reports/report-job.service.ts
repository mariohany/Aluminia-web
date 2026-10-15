import { Injectable, Logger } from '@nestjs/common';
import type { ReportLanguage, ReportProgressGroup } from '@repo/types/reports';
import { ReportCache } from '../../database/tenant/entities/report-cache.entity';
import { TenantConnectionService } from '../tenancy/tenant-connection.service';
import { MEMBER_ORDER, profileQueue } from './bar-optimiser/project';
import { BarOptimiserRunner } from './bar-optimiser/runner';
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
// and its TenantContextService are long gone by then.

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
  fingerprint: string;
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

  constructor(
    private readonly connection: TenantConnectionService,
    private readonly runner: BarOptimiserRunner,
  ) {}

  /** Fire and forget: failures land on the row as `job_state = failed`. */
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

    try {
      const result = await this.runner.run(
        job.pieces.pieces,
        {
          lengths: job.inputs.settings.stockLengthsMm,
          kerfMm: job.inputs.settings.kerfMm,
          endTrimMm: job.inputs.settings.endTrimMm,
        },
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
      );
      const summary = summaryOf(job.inputs, job.pieces, result);
      // The PDF is rendered here from `result` (Step 6); none until then.
      const pdf: Buffer | null = null;
      clearInterval(heartbeat);
      await writes;
      await this.update(job, {
        fingerprint: job.fingerprint,
        windowStamps: job.windowStamps,
        summary,
        pdf,
        generatedAt: new Date(),
        generatedByUserId: job.userId,
        jobState: null,
        jobFingerprint: null,
        jobProgress: null,
        jobStartedAt: null,
        jobStartedByUserId: null,
        jobError: null,
      });
    } catch (error) {
      clearInterval(heartbeat);
      await writes;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bar optimiser report failed: ${message}`);
      await this.update(job, { jobState: 'failed', jobError: message }).catch(
        (writeError: unknown) =>
          this.logger.error(
            `Could not record the failed report job: ${String(writeError)}`,
          ),
      );
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
