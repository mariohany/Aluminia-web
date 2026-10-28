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
  plansByLength,
  solvedFromLengths,
  validateSolve,
  type LengthPlans,
  type SolveResult,
  type SolvedProfile,
} from '@repo/bar-optimiser/solve-result';
import {
  DEFAULT_CUTTING_SETTINGS,
  ReportKind,
  SolveError,
  SolveRefusal,
  stockLengthsOf,
  type BarOptimiserReport,
  type BarOptimiserReportResponse,
  type CuttingSettings,
  type CuttingSettingsInput,
  type ReportProgressGroup,
  type ReportStatus,
  type SolveProgressInput,
  type SolveResultInput,
  type SolveStart,
  type StopSolveInput,
} from '@repo/types/reports';
import { Color } from '../../database/control-plane/entities/color.entity';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { CuttingSettingsRow } from '../../database/tenant/entities/cutting-settings.entity';
import { ReportSolve } from '../../database/tenant/entities/report-solve.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { assertProfileComplete } from '../company/company-profile.service';
import {
  buildProjectPieces,
  changedWindowCount,
  initialProgress,
  loadReportInputs,
  namesOf,
  planKeysOf,
  profileNoOf,
  recolored,
  reportSnapshotOf,
  weightsOf,
  snapshotFingerprintOf,
  solveFingerprintOf,
  windowStampsOf,
  type ReportInputs,
} from './report-inputs';

// docs/reports_planing.md §7, docs/browser_solve_planing.md §7,
// docs/browser_pdf_planing.md §7. The server never solves and never
// prints: /solve hands a browser the piece lines and a token,
// /solve/progress is that browser's heartbeat, /solve/result checks its
// plans and saves them with the report snapshot, /report hands the
// snapshot (+ today's company details) to whoever draws the PDF, and
// /refresh re-saves the names after a project or client rename. Every
// request does its tenant work in ONE `tenantContext.run()`; platform
// catalogue and user reads (control plane) are mixed in freely.

const KIND = ReportKind.BAR_OPTIMISER;

/** A solve whose browser stayed silent this long is over (its heartbeat
 * comes every 15 s; B5). */
export const SOLVE_ORPHANED_AFTER_MS = 60_000;

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(SystemProfile)
    private readonly platformProfiles: Repository<SystemProfile>,
    @InjectRepository(SystemCatalog)
    private readonly platformCatalogs: Repository<SystemCatalog>,
    @InjectRepository(Color)
    private readonly platformColors: Repository<Color>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
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

  status(projectId: string, userId: string): Promise<ReportStatus> {
    return this.tenantContext.run(async (manager) =>
      this.toStatus(manager, await this.inputs(manager, projectId), userId),
    );
  }

  /** The snapshot to draw the PDF from, plus the company as it is today
   * (P7: logo and names always the latest). 404 before the first
   * Generate. A stale snapshot is still returned (D15: the previous
   * report stays readable, marked out of date). */
  report(projectId: string): Promise<BarOptimiserReportResponse> {
    const { companyName } = this.tenantContext.tenant;
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      await assertProfileComplete(manager, companyName);
      const solve = await findSolve(manager, projectId);
      if (!solve?.report) {
        throw new NotFoundException('No report generated yet.');
      }
      const { letterhead } = inputs;
      return {
        report: solve.report as BarOptimiserReport,
        company: {
          enName: letterhead.enName || companyName,
          arName: letterhead.arName,
          logoFileId: letterhead.logoFileId,
        },
      };
    });
  }

  /** Only the project, the client or a colour code was renamed (P8):
   * re-save the snapshot's names, no solve. 409 `no_solve` when the plan itself is out of date
   * (windows, settings or profiles changed): that needs Generate. */
  refresh(projectId: string, userId: string): Promise<ReportStatus> {
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const solve = await lockSolve(manager, projectId, false);
      if (
        !solve?.report ||
        solve.solveFingerprint !== solveFingerprintOf(inputs)
      ) {
        throw new ConflictException({
          message: 'Generate the report first.',
          code: SolveRefusal.NO_SOLVE,
        });
      }
      const report = solve.report as BarOptimiserReport;
      solve.report = {
        ...report,
        ...namesOf(inputs),
        // A renamed colour code (report colours §4).
        summary: {
          ...report.summary,
          profiles: report.summary.profiles.map((p) =>
            p.colors ? { ...p, colors: recolored(inputs, p.colors) } : p,
          ),
        },
        plans: report.plans.map((p) =>
          p.colors ? { ...p, colors: recolored(inputs, p.colors) } : p,
        ),
      };
      solve.snapshotFingerprint = snapshotFingerprintOf(inputs);
      await manager.save(solve);
      return this.toStatus(manager, inputs, userId);
    });
  }

  /** Starts a solve in the asking browser (B5): hands it the piece lines
   * and a token only it may write with. 409 while another browser's
   * solve is alive. The row is locked so two clicks can't both start. */
  startSolve(
    projectId: string,
    userId: string,
    optimiserVersion: number,
  ): Promise<SolveStart> {
    assertOptimiser(optimiserVersion);
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      await assertProfileComplete(
        manager,
        this.tenantContext.tenant.companyName,
      );
      const solve = await lockSolve(manager, projectId, true);
      if (isSolving(solve)) {
        throw new ConflictException({
          message: 'This report is being made on another computer.',
          code: SolveRefusal.SOLVING_ELSEWHERE,
        });
      }

      const pieces = buildProjectPieces(inputs);
      const reused = reusablePlans(solve, planKeysOf(inputs, pieces));
      solve.solveState = 'solving';
      solve.solveToken = randomUUID();
      solve.solvePendingFingerprint = solveFingerprintOf(inputs);
      solve.solveProgress = {
        groups: initialProgress(pieces, new Set(reused.keys())),
      };
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
        reused: [...reused.keys()],
        status: await this.toStatus(manager, inputs, userId),
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
   * (docs/browser_solve_planing.md §5) and saved with the report snapshot
   * the PDF is drawn from. Refused when windows changed meanwhile (Q1) or
   * the plans don't hold up; either way the solve ends, so others can
   * start one. */
  async solveResult(
    projectId: string,
    userId: string,
    input: SolveResultInput,
  ): Promise<ReportStatus> {
    assertOptimiser(input.optimiserVersion);
    // Set inside the transaction, thrown after it commits.
    const outcome: { refusal?: Error } = {};

    const status = await this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const solve = await lockSolve(manager, projectId, false);
      if (solve?.solveState !== 'solving' || solve.solveToken !== input.token) {
        throw solveLost();
      }

      const fingerprint = solveFingerprintOf(inputs);
      const pieces = buildProjectPieces(inputs);
      const keys = planKeysOf(inputs, pieces);
      // The profiles the browser skipped (`reused` at the start) come
      // from the last solve, onto today's lines; one it sent anyway (an
      // older tab) is taken as sent.
      const lines = pieces.pieces.map(
        ({ profile, member, lengthMm, count }) => ({
          profile,
          member,
          lengthMm,
          count,
        }),
      );
      const sent = new Set(input.profiles.map((p) => p.profile));
      const filled: SolvedProfile[] = [];
      for (const [profile, plans] of reusablePlans(solve, keys)) {
        if (sent.has(profile)) continue;
        const back = solvedFromLengths(profile, plans, lines);
        if (back) filled.push(back);
      }
      const result: StoredSolveResult = {
        profiles: [...input.profiles, ...filled],
      };
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
            weightsOf(inputs),
          );
          const solvedAt = new Date();
          solve.solveFingerprint = fingerprint;
          solve.snapshotFingerprint = snapshotFingerprintOf(inputs);
          solve.windowStamps = windowStampsOf(inputs);
          result.plans = Object.fromEntries(
            result.profiles.map((p) => [
              p.profile,
              { key: keys.get(p.profile)!, ...plansByLength(p, lines) },
            ]),
          );
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
      return outcome.refusal ? null : this.toStatus(manager, inputs, userId);
    });

    if (outcome.refusal) throw outcome.refusal;
    return status as ReportStatus;
  }

  /** Stop (B6), or the browser giving up (`error`, B11). Only the token's
   * own solve; anything else is already over. */
  stopSolve(
    projectId: string,
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
      return this.toStatus(manager, inputs, userId);
    });
  }

  private async inputs(
    manager: EntityManager,
    projectId: string,
  ): Promise<ReportInputs> {
    const inputs = await loadReportInputs(
      manager,
      {
        profiles: this.platformProfiles,
        catalogs: this.platformCatalogs,
        colors: this.platformColors,
      },
      projectId,
    );
    if (!inputs) throw new NotFoundException('Project not found.');
    return inputs;
  }

  private async toStatus(
    manager: EntityManager,
    inputs: ReportInputs,
    userId: string,
  ): Promise<ReportStatus> {
    const solve = await findSolve(manager, inputs.project.id);
    // A solve whose browser went quiet (tab closed) is over (B5).
    if (solve?.solveState === 'solving' && !isSolving(solve)) {
      endSolve(solve, SolveError.STOPPED);
      await manager.save(solve);
    }

    const report = (solve?.report as BarOptimiserReport | null) ?? null;
    const staleBecause = !report
      ? null
      : solve!.snapshotFingerprint === snapshotFingerprintOf(inputs)
        ? null
        : solve!.solveFingerprint === solveFingerprintOf(inputs)
          ? 'names'
          : 'solve';

    return {
      state: !report ? 'none' : staleBecause ? 'stale' : 'fresh',
      staleBecause,
      generatedAt: report?.generatedAt ?? null,
      changedWindows:
        staleBecause === 'solve'
          ? changedWindowCount(
              solve?.windowStamps ?? null,
              windowStampsOf(inputs),
            )
          : 0,
      summary: report?.summary ?? null,
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

/** `report_solve.result`: the browser's plans on line numbers, and from
 * 2026-10-24 each profile's plan key + plans by length, to reuse
 * (docs/report_speed_planing.md §6). */
interface StoredSolveResult extends SolveResult {
  plans?: Record<string, LengthPlans & { key: string }>;
}

/** The last solve's plans of every profile whose key is still today's. */
function reusablePlans(
  solve: ReportSolve,
  keys: Map<string, string>,
): Map<string, LengthPlans> {
  const stored = (solve.result as StoredSolveResult | null)?.plans ?? {};
  const out = new Map<string, LengthPlans>();
  for (const [profile, key] of keys) {
    const plans = stored[profile];
    if (plans && plans.key === key) out.set(profile, plans);
  }
  return out;
}

function findSolve(
  manager: EntityManager,
  projectId: string,
): Promise<ReportSolve | null> {
  return manager.findOne(ReportSolve, {
    where: { projectId, reportKind: KIND },
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

/** Solving, and its browser touched it recently enough to be alive. */
function isSolving(solve: ReportSolve): boolean {
  return (
    solve.solveState === 'solving' &&
    Date.now() - solve.updatedAt.getTime() < SOLVE_ORPHANED_AFTER_MS
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
