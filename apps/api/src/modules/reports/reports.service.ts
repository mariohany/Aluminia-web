import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { EntityManager, Repository } from 'typeorm';
import { OPTIMISER_VERSION } from '@repo/bar-optimiser/version';
import {
  SolveRefused,
  validateSolve,
  type SolveResult,
} from '@repo/bar-optimiser/solve-result';
import {
  DEFAULT_CUTTING_SETTINGS,
  ReportKind,
  SolveError,
  SolveRefusal,
  stockLengthsOf,
  type BarOptimiserReport,
  type CuttingSettings,
  type CuttingSettingsInput,
  type ReportLanguage,
  type ReportProgressGroup,
  type ReportStatus,
  type SolveProgressInput,
  type SolveResultInput,
  type SolveStart,
  type StopSolveInput,
} from '@repo/types/reports';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { CuttingSettingsRow } from '../../database/tenant/entities/cutting-settings.entity';
import { ReportCache } from '../../database/tenant/entities/report-cache.entity';
import { ReportSolve } from '../../database/tenant/entities/report-solve.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  buildProjectPieces,
  changedWindowCount,
  loadReportInputs,
  printFingerprintOf,
  profileNoOf,
  reportSnapshotOf,
  snapshotFingerprintOf,
  solveFingerprintOf,
  windowStampsOf,
  type ReportInputs,
} from './report-inputs';
import { ReportJobQueue, jobQueueKey } from './report-job-queue';
import {
  JOB_ORPHANED_AFTER_MS,
  ReportJobService,
  initialProgress,
  type ReportJob,
} from './report-job.service';

// docs/reports_planing.md §7, docs/browser_solve_planing.md §7. The
// project's solve is made in a browser: /solve hands out the piece lines
// and a token, /solve/progress is that browser's heartbeat, /solve/result
// checks and stores its plans and queues the print of the language on
// screen, /print prints another language from the stored solve. Every
// request does its tenant work in ONE `tenantContext.run()`; platform
// catalogue and user reads (control plane) are mixed in freely.

const KIND = ReportKind.BAR_OPTIMISER;

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(SystemProfile)
    private readonly platformProfiles: Repository<SystemProfile>,
    @InjectRepository(SystemCatalog)
    private readonly platformCatalogs: Repository<SystemCatalog>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jobs: ReportJobService,
    private readonly queue: ReportJobQueue,
  ) {}

  getSettings(): Promise<CuttingSettings> {
    return this.tenantContext.run(async (manager) =>
      toSettings(
        await manager.findOne(CuttingSettingsRow, { where: { id: 1 } }),
      ),
    );
  }

  /** Saving moves `updated_at`, which every solve fingerprint reads:
   * every project's report turns stale (D14). */
  saveSettings(input: CuttingSettingsInput): Promise<CuttingSettings> {
    return this.tenantContext.run(async (manager) => {
      const row =
        (await manager.findOne(CuttingSettingsRow, { where: { id: 1 } })) ??
        manager.create(CuttingSettingsRow, { id: 1 });
      row.kerfMm = input.kerfMm;
      row.endTrimMm = input.endTrimMm;
      row.extraLengthsMm = [...input.extraLengthsMm].sort((a, b) => b - a);
      row.updatedAt = new Date();
      return toSettings(await manager.save(row));
    });
  }

  status(
    projectId: string,
    language: ReportLanguage,
    userId: string,
  ): Promise<ReportStatus> {
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const row = await findRow(manager, projectId, language);
      return this.toStatus(manager, inputs, row, language, userId);
    });
  }

  /** Starts a solve in the asking browser (B5): hands it the piece lines
   * and a token only it may write with. 409 while another browser's
   * solve is alive. The row is locked so two clicks can't both start. */
  async startSolve(
    projectId: string,
    language: ReportLanguage,
    userId: string,
    optimiserVersion: number,
  ): Promise<SolveStart> {
    assertOptimiser(optimiserVersion);
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const solve = await lockSolve(manager, projectId, true);
      if (isSolving(solve)) {
        throw new ConflictException({
          message: 'This report is being made on another computer.',
          code: SolveRefusal.SOLVING_ELSEWHERE,
        });
      }

      const pieces = buildProjectPieces(inputs);
      solve.solveState = 'solving';
      solve.solveToken = randomUUID();
      solve.solvePendingFingerprint = solveFingerprintOf(inputs);
      solve.solveProgress = { groups: initialProgress(pieces) };
      solve.solveStartedAt = new Date();
      solve.solveStartedByUserId = userId;
      solve.solveError = null;
      await manager.save(solve);

      const { settings } = inputs;
      return {
        token: solve.solveToken,
        settings: {
          lengths: settings.stockLengthsMm,
          kerfMm: settings.kerfMm,
          endTrimMm: settings.endTrimMm,
        },
        lines: pieces.pieces.map(({ profile, member, lengthMm, count }) => ({
          profile,
          member,
          lengthMm,
          count,
        })),
        profileNos: Object.fromEntries(
          [...new Set(pieces.pieces.map((p) => p.profile))].map((ref) => [
            ref,
            profileNoOf(inputs, ref),
          ]),
        ),
        status: await this.toStatus(
          manager,
          inputs,
          await findRow(manager, projectId, language),
          language,
          userId,
        ),
      };
    });
  }

  /** The solving browser's progress, and its heartbeat (B5). 409 once
   * its token no longer holds the solve (stopped, taken over). */
  progress(projectId: string, input: SolveProgressInput): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const updated = await manager
        .createQueryBuilder()
        .update(ReportSolve)
        .set({
          solveProgress: { groups: input.groups },
          updatedAt: () => 'now()',
        })
        .where(
          `project_id = :projectId AND report_kind = :kind AND solve_token = :token AND solve_state = 'solving'`,
          { projectId, kind: KIND, token: input.token },
        )
        .execute();
      if (!updated.affected) throw solveLost();
    });
  }

  /** A browser's finished solve: checked against today's piece lines
   * (§5), stored for every language, then this language is queued to
   * print (B7). Refused when windows changed meanwhile (Q1) or the plans
   * don't hold up; either way the solve ends, so others can start one. */
  async solveResult(
    projectId: string,
    language: ReportLanguage,
    userId: string,
    input: SolveResultInput,
  ): Promise<ReportStatus> {
    assertOptimiser(input.optimiserVersion);
    // Set inside the transaction, acted on after it commits.
    const outcome: { refusal?: Error; job?: ReportJob | null } = {};

    const status = await this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const solve = await lockSolve(manager, projectId, false);
      if (solve?.solveState !== 'solving' || solve.solveToken !== input.token) {
        throw solveLost();
      }

      const fingerprint = solveFingerprintOf(inputs);
      const pieces = buildProjectPieces(inputs);
      const result: SolveResult = { profiles: input.profiles };
      if (solve.solvePendingFingerprint !== fingerprint) {
        outcome.refusal = new ConflictException({
          message: 'Windows changed while the report was being made.',
          code: SolveRefusal.WINDOWS_CHANGED,
        });
        endSolve(solve, SolveError.WINDOWS_CHANGED);
      } else {
        try {
          const checked = validateSolve(
            pieces.pieces,
            {
              lengths: inputs.settings.stockLengthsMm,
              kerfMm: inputs.settings.kerfMm,
              endTrimMm: inputs.settings.endTrimMm,
            },
            result,
          );
          const solvedAt = new Date();
          solve.solveFingerprint = fingerprint;
          solve.snapshotFingerprint = snapshotFingerprintOf(inputs);
          solve.windowStamps = windowStampsOf(inputs);
          solve.result = result;
          solve.report = reportSnapshotOf(inputs, pieces, checked, solvedAt);
          solve.solvedAt = solvedAt;
          solve.solvedByUserId = userId;
          endSolve(solve, null);
        } catch (error) {
          if (!(error instanceof SolveRefused)) throw error;
          outcome.refusal = new UnprocessableEntityException(error.message);
          endSolve(solve, SolveError.FAILED);
        }
      }
      await manager.save(solve);
      if (outcome.refusal) return null;

      outcome.job = await this.reservePrint(
        manager,
        inputs,
        language,
        userId,
        solve,
      );
      return this.toStatus(
        manager,
        inputs,
        await findRow(manager, projectId, language),
        language,
        userId,
      );
    });

    // Thrown after the commit, so the ended solve is saved.
    if (outcome.refusal) throw outcome.refusal;
    return this.startPrint(outcome.job ?? null, status as ReportStatus);
  }

  /** Stop (B6), or the browser giving up (`error`, B11). Only the token's
   * own solve; anything else is already over. */
  stopSolve(
    projectId: string,
    language: ReportLanguage,
    userId: string,
    input: StopSolveInput,
  ): Promise<ReportStatus> {
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const solve = await lockSolve(manager, projectId, false);
      if (solve?.solveState === 'solving' && solve.solveToken === input.token) {
        endSolve(solve, input.error ?? null);
        await manager.save(solve);
      }
      return this.toStatus(
        manager,
        inputs,
        await findRow(manager, projectId, language),
        language,
        userId,
      );
    });
  }

  /** Prints this language from the project's stored solve, without
   * solving (B4, B8). 409 when there is no solve for today's inputs. One
   * print per project + language at a time: while one is alive, this just
   * reports it. */
  async print(
    projectId: string,
    language: ReportLanguage,
    userId: string,
  ): Promise<ReportStatus> {
    const outcome: { job?: ReportJob | null } = {};
    const status = await this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const solve = await lockSolve(manager, projectId, false);
      if (
        !solve?.solveFingerprint ||
        solve.solveFingerprint !== solveFingerprintOf(inputs)
      ) {
        throw new ConflictException({
          message: 'Generate the report first.',
          code: SolveRefusal.NO_SOLVE,
        });
      }
      outcome.job = await this.reservePrint(
        manager,
        inputs,
        language,
        userId,
        solve,
      );
      return this.toStatus(
        manager,
        inputs,
        await findRow(manager, projectId, language),
        language,
        userId,
      );
    });
    return this.startPrint(outcome.job ?? null, status);
  }

  pdf(
    projectId: string,
    language: ReportLanguage,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const row = await manager
        .createQueryBuilder(ReportCache, 'r')
        .addSelect('r.pdf')
        .where(
          'r.project_id = :projectId AND r.report_kind = :kind AND r.language = :language',
          { projectId, kind: KIND, language },
        )
        .getOne();
      if (!row?.pdf) throw new NotFoundException('No report generated yet.');
      return {
        pdf: row.pdf,
        fileName: `${fileSlug(inputs.project.enName)}-bar-optimiser-${language}.pdf`,
      };
    });
  }

  /** Reserves this language's cache row for a print of `solve`, unless a
   * print is already alive. The job starts after the commit
   * (`startPrint`), so its first write finds the row reserved. */
  private async reservePrint(
    manager: EntityManager,
    inputs: ReportInputs,
    language: ReportLanguage,
    userId: string,
    solve: ReportSolve,
  ): Promise<ReportJob | null> {
    const projectId = inputs.project.id;
    await manager
      .createQueryBuilder()
      .insert()
      .into(ReportCache)
      .values({ projectId, reportKind: KIND, language })
      .orIgnore()
      .execute();
    const row = await manager
      .createQueryBuilder(ReportCache, 'r')
      .setLock('pessimistic_write')
      .where(
        'r.project_id = :projectId AND r.report_kind = :kind AND r.language = :language',
        { projectId, kind: KIND, language },
      )
      .getOneOrFail();
    if (isAlive(row)) return null;

    const fingerprint = printFingerprintOf(inputs, language);
    const startedAt = new Date();
    // `running` when it will start at once, so an idle server never
    // flashes "Queued"; toStatus trusts the queue over the row anyway.
    row.jobState = this.queue.hasFreeSlot() ? 'running' : 'queued';
    row.jobFingerprint = fingerprint;
    row.jobProgress = null;
    row.jobStartedAt = startedAt;
    row.jobStartedByUserId = userId;
    row.jobError = null;
    await manager.save(row);

    const { schemaName, companyId, companyName } = this.tenantContext.tenant;
    return {
      schemaName,
      cacheId: row.id,
      startedAt,
      userId,
      language,
      companyId,
      companyName,
      fingerprint,
      inputs,
      pieces: buildProjectPieces(inputs),
      solve: solve.result as SolveResult,
    };
  }

  /** Hands a reserved print to the queue; its place is known at once. */
  private startPrint(
    job: ReportJob | null,
    status: ReportStatus,
  ): ReportStatus {
    if (!job) return status;
    this.jobs.start(job);
    const queuePosition = this.queue.positionOf(
      jobQueueKey(job.cacheId, job.startedAt),
    );
    if (status.job && queuePosition !== null) {
      status.job = { ...status.job, state: 'queued', queuePosition };
    }
    return status;
  }

  private async inputs(
    manager: EntityManager,
    projectId: string,
  ): Promise<ReportInputs> {
    const inputs = await loadReportInputs(
      manager,
      { profiles: this.platformProfiles, catalogs: this.platformCatalogs },
      projectId,
    );
    if (!inputs) throw new NotFoundException('Project not found.');
    return inputs;
  }

  private async toStatus(
    manager: EntityManager,
    inputs: ReportInputs,
    row: ReportCache | null,
    language: ReportLanguage,
    userId: string,
  ): Promise<ReportStatus> {
    // A print whose server died never finishes: mark it failed (D22).
    if (
      (row?.jobState === 'queued' || row?.jobState === 'running') &&
      !isAlive(row)
    ) {
      row.jobState = 'failed';
      row.jobError = 'interrupted';
      await manager.save(row);
    }
    const solve = await manager.findOne(ReportSolve, {
      where: { projectId: inputs.project.id, reportKind: KIND },
    });
    // A solve whose browser went quiet (tab closed) is over (B5).
    if (solve?.solveState === 'solving' && !isSolving(solve)) {
      endSolve(solve, SolveError.STOPPED);
      await manager.save(solve);
    }

    const stamps = windowStampsOf(inputs);
    const fingerprint = printFingerprintOf(inputs, language);
    const state = !row?.fingerprint
      ? 'none'
      : row.fingerprint === fingerprint
        ? 'fresh'
        : 'stale';
    const hasPdf = row
      ? Boolean(
          (
            await manager.query<{ has: boolean }[]>(
              'SELECT (pdf IS NOT NULL) AS "has" FROM report_cache WHERE id = $1',
              [row.id],
            )
          )[0]?.has,
        )
      : false;
    // While this instance holds the job in its line, it is queued,
    // whatever the row says (C4, C6).
    const queuePosition =
      row?.jobStartedAt && row.jobState !== 'failed'
        ? this.queue.positionOf(jobQueueKey(row.id, row.jobStartedAt))
        : null;

    return {
      state,
      generatedAt: row?.generatedAt?.toISOString() ?? null,
      changedWindows:
        state === 'stale'
          ? changedWindowCount(solve?.windowStamps ?? null, stamps)
          : 0,
      hasPdf,
      hasSolve:
        !!solve?.solveFingerprint &&
        solve.solveFingerprint === solveFingerprintOf(inputs),
      summary:
        state === 'none'
          ? null
          : ((solve?.report as BarOptimiserReport | null)?.summary ?? null),
      job:
        row?.jobState && row.jobStartedAt
          ? {
              state: queuePosition !== null ? 'queued' : row.jobState,
              startedAt: row.jobStartedAt.toISOString(),
              groups: [],
              queuePosition,
              error: row.jobError,
            }
          : null,
      solve:
        solve?.solveState && solve.solveStartedAt
          ? {
              state: solve.solveState,
              startedAt: solve.solveStartedAt.toISOString(),
              startedByEmail: await this.emailOf(solve.solveStartedByUserId),
              startedByMe: solve.solveStartedByUserId === userId,
              groups:
                (solve.solveProgress as { groups?: ReportProgressGroup[] })
                  ?.groups ?? [],
              error: solve.solveError as SolveError | null,
            }
          : null,
    };
  }

  private async emailOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, email: true },
    });
    return user?.email ?? null;
  }
}

/** The browser's optimiser must be the API's (B12). */
function assertOptimiser(version: number): void {
  if (version !== OPTIMISER_VERSION) {
    throw new ConflictException({
      message: 'Aluminia was updated. Reload the page to make this report.',
      code: SolveRefusal.OUTDATED_CLIENT,
    });
  }
}

function solveLost(): ConflictException {
  return new ConflictException({
    message: 'This report is no longer being made here.',
    code: SolveRefusal.SOLVE_LOST,
  });
}

/** The project's solve row, locked; created first when `create` is set. */
async function lockSolve(
  manager: EntityManager,
  projectId: string,
  create: true,
): Promise<ReportSolve>;
async function lockSolve(
  manager: EntityManager,
  projectId: string,
  create: false,
): Promise<ReportSolve | null>;
async function lockSolve(
  manager: EntityManager,
  projectId: string,
  create: boolean,
): Promise<ReportSolve | null> {
  if (create) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(ReportSolve)
      .values({ projectId, reportKind: KIND })
      .orIgnore()
      .execute();
  }
  return manager
    .createQueryBuilder(ReportSolve, 's')
    .setLock('pessimistic_write')
    .where('s.project_id = :projectId AND s.report_kind = :kind', {
      projectId,
      kind: KIND,
    })
    .getOne();
}

/** Ends the solve in progress: cleared, or failed with `error`. The
 * last good solve on the row stays. */
function endSolve(solve: ReportSolve, error: SolveError | null): void {
  solve.solveToken = null;
  solve.solvePendingFingerprint = null;
  if (error) {
    solve.solveState = 'failed';
    solve.solveError = error;
    return;
  }
  solve.solveState = null;
  solve.solveError = null;
  solve.solveProgress = null;
  solve.solveStartedAt = null;
  solve.solveStartedByUserId = null;
}

function findRow(
  manager: EntityManager,
  projectId: string,
  language: ReportLanguage,
): Promise<ReportCache | null> {
  return manager.findOne(ReportCache, {
    where: { projectId, reportKind: KIND, language },
  });
}

/** Solving, and its browser touched it recently enough to be alive. */
function isSolving(solve: ReportSolve): boolean {
  return (
    solve.solveState === 'solving' &&
    Date.now() - solve.updatedAt.getTime() < JOB_ORPHANED_AFTER_MS
  );
}

/** Queued or running, and touched recently enough that its server is
 * still alive (a waiting job heartbeats too). */
function isAlive(row: ReportCache): boolean {
  return (
    (row.jobState === 'queued' || row.jobState === 'running') &&
    Date.now() - row.updatedAt.getTime() < JOB_ORPHANED_AFTER_MS
  );
}

function toSettings(row: CuttingSettingsRow | null): CuttingSettings {
  const base = row ?? DEFAULT_CUTTING_SETTINGS;
  return {
    kerfMm: base.kerfMm,
    endTrimMm: base.endTrimMm,
    extraLengthsMm: [...base.extraLengthsMm],
    stockLengthsMm: stockLengthsOf(base),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}
