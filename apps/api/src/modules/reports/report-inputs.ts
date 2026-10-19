import { createHash } from 'node:crypto';
import { In, type EntityManager, type Repository } from 'typeorm';
import { LookupScope, parseScopedRef } from '@repo/types/company-lookups';
import type { SystemType } from '@repo/types/lookups';
import {
  DEFAULT_CUTTING_SETTINGS,
  stockLengthsOf,
  type BarOptimiserReport,
  type BarOptimiserSummary,
  type ReportPieceAt,
  type ReportPlanTotals,
  type ReportProgressGroup,
} from '@repo/types/reports';
import type { WindowDetail } from '@repo/types/windows';
import { buildCutList, type CutMember } from '@repo/geometry/cut-list';
import { OPTIMISER_VERSION } from '@repo/bar-optimiser/version';
import type { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import type { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { CompanySystemCatalog } from '../../database/tenant/entities/company-system-catalog.entity';
import { CompanySystemProfile } from '../../database/tenant/entities/company-system-profile.entity';
import { CuttingSettingsRow } from '../../database/tenant/entities/cutting-settings.entity';
import { CompanyProfileRow } from '../../database/tenant/entities/company-profile.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { loadProjectWindows } from '../windows/windows.service';
import type { CutPlan } from '@repo/bar-optimiser/optimise';
import {
  MEMBER_ORDER,
  profileQueue,
  type ProjectOptimisation,
  type ProjectPiece,
} from '@repo/bar-optimiser/project';

// Everything a bar optimiser report is made from, read in one tenant
// transaction, and what follows from it: the fingerprint that says
// whether a cached report is still current (docs/reports_planing.md §6,
// D14), the pieces handed to the optimiser, and the stored summary.

/** Bump when the cut-list rules or the PDF change in a way that should
 * make every cached report stale (optimiser changes bump
 * `OPTIMISER_VERSION` instead). 2: the header prints the company profile
 * (docs/company_profile_planing.md §5). 3: one solve per project, printed
 * per language (docs/browser_solve_planing.md §6). 4: the browser draws
 * the PDF from a saved snapshot (docs/browser_pdf_planing.md §4). */
export const REPORT_VERSION = 4;

export interface PieceRef {
  windowId: string;
  windowName: string;
  member: CutMember;
  at: ReportPieceAt;
}

interface ProfileFacts {
  profileNo: string;
  systemType: SystemType | null;
  acceptsFlyScreen: boolean;
  /** Profile + catalogue `updated_at`: part of the fingerprint. */
  stamp: string;
}

export interface ReportInputs {
  project: Project;
  windows: WindowDetail[];
  settings: {
    kerfMm: number;
    endTrimMm: number;
    extraLengthsMm: number[];
    stockLengthsMm: number[];
    updatedAt: Date | null;
  };
  /** Every profile ref the windows use. Absent = the row is gone. */
  profiles: Map<string, ProfileFacts>;
  /** The company profile's printed names + logo for the header
   * (docs/company_profile_planing.md §5). Null names = not saved yet:
   * the header falls back to the account name. */
  letterhead: {
    enName: string | null;
    arName: string | null;
    logoFileId: string | null;
    updatedAt: Date | null;
  };
}

export interface PlatformRepos {
  profiles: Repository<SystemProfile>;
  catalogs: Repository<SystemCatalog>;
}

/** `null` when the project doesn't exist (in this tenant). */
export async function loadReportInputs(
  manager: EntityManager,
  platform: PlatformRepos,
  projectId: string,
): Promise<ReportInputs | null> {
  const project = await manager.findOne(Project, {
    where: { id: projectId },
    relations: { client: true },
  });
  if (!project) return null;

  const windows = await loadProjectWindows(manager, projectId);
  const row = await manager.findOne(CuttingSettingsRow, { where: { id: 1 } });
  const base = row ?? DEFAULT_CUTTING_SETTINGS;
  const settings = {
    kerfMm: base.kerfMm,
    endTrimMm: base.endTrimMm,
    extraLengthsMm: [...base.extraLengthsMm],
    stockLengthsMm: stockLengthsOf(base),
    updatedAt: row?.updatedAt ?? null,
  };
  const profile = await manager.findOne(CompanyProfileRow, {
    where: { id: 1 },
  });

  return {
    project,
    windows,
    settings,
    profiles: await loadProfiles(manager, platform, profileRefsOf(windows)),
    letterhead: {
      enName: profile?.enName ?? null,
      arName: profile?.arName ?? null,
      logoFileId: profile?.logoFileId ?? null,
      updatedAt: profile?.updatedAt ?? null,
    },
  };
}

function profileRefsOf(windows: WindowDetail[]): Set<string> {
  const refs = new Set<string>();
  const add = (ref: string | null | undefined) => {
    if (ref) refs.add(ref);
  };
  for (const window of windows) {
    for (const panel of window.panels) {
      add(panel.frameProfile);
      add(panel.dividerProfile);
      panel.dividers.forEach((d) => add(d.profile));
      panel.sections.forEach((s) => {
        add(s.sashProfile);
        add(s.beadProfile);
      });
    }
  }
  return refs;
}

async function loadProfiles(
  manager: EntityManager,
  platform: PlatformRepos,
  refs: Set<string>,
): Promise<Map<string, ProfileFacts>> {
  const platformIds: string[] = [];
  const companyIds: string[] = [];
  for (const ref of refs) {
    const { scope, id } = parseScopedRef(ref);
    (scope === LookupScope.PLATFORM ? platformIds : companyIds).push(id);
  }

  const companyProfiles = companyIds.length
    ? await manager.find(CompanySystemProfile, {
        where: { id: In(companyIds) },
      })
    : [];
  const platformProfiles = platformIds.length
    ? await platform.profiles.find({ where: { id: In(platformIds) } })
    : [];

  const companyCatalogIds = companyProfiles.flatMap((p) =>
    p.companyCatalogId ? [p.companyCatalogId] : [],
  );
  const platformCatalogIds = [
    ...platformProfiles.map((p) => p.catalogId),
    ...companyProfiles.flatMap((p) =>
      p.platformCatalogId ? [p.platformCatalogId] : [],
    ),
  ];
  const companyCatalogs = companyCatalogIds.length
    ? await manager.find(CompanySystemCatalog, {
        where: { id: In(companyCatalogIds) },
      })
    : [];
  const platformCatalogs = platformCatalogIds.length
    ? await platform.catalogs.find({ where: { id: In(platformCatalogIds) } })
    : [];

  const catalog = (platformId: string | null, companyId: string | null) =>
    platformId
      ? platformCatalogs.find((c) => c.id === platformId)
      : companyCatalogs.find((c) => c.id === companyId);
  const stampOf = (
    profile: { updatedAt: Date },
    cat: { updatedAt: Date } | undefined,
  ) =>
    `${profile.updatedAt.toISOString()}|${cat?.updatedAt.toISOString() ?? '-'}`;

  const facts = new Map<string, ProfileFacts>();
  for (const p of platformProfiles) {
    const cat = catalog(p.catalogId, null);
    facts.set(`${LookupScope.PLATFORM}:${p.id}`, {
      profileNo: p.profileNo,
      systemType: cat?.systemType ?? null,
      acceptsFlyScreen: p.acceptsFlyScreen,
      stamp: stampOf(p, cat),
    });
  }
  for (const p of companyProfiles) {
    const cat = catalog(p.platformCatalogId, p.companyCatalogId);
    facts.set(`${LookupScope.COMPANY}:${p.id}`, {
      profileNo: p.profileNo,
      systemType: cat?.systemType ?? null,
      acceptsFlyScreen: p.acceptsFlyScreen,
      stamp: stampOf(p, cat),
    });
  }
  return facts;
}

/** sha-256 over everything the cutting plan is made from (D14,
 * docs/browser_solve_planing.md §6): the windows, the cutting settings,
 * every profile used and its catalogue, `REPORT_VERSION` and
 * `OPTIMISER_VERSION`. A change here means solve again. */
export function solveFingerprintOf(inputs: ReportInputs): string {
  return sha256({
    v: REPORT_VERSION,
    optimiser: OPTIMISER_VERSION,
    settings: inputs.settings.updatedAt?.toISOString() ?? 'default',
    windows: Object.entries(windowStampsOf(inputs)).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    profiles: [...profileRefsOf(inputs.windows)]
      .sort()
      .map((ref) => [ref, inputs.profiles.get(ref)?.stamp ?? 'missing']),
  });
}

/** sha-256 over what the saved snapshot freezes (P6): the solve
 * fingerprint plus the project and the client. A change only in the
 * project or client means refresh the names, no solve (P8). The company
 * (letterhead) is not in it: it is always drawn as it is today (P7). */
export function snapshotFingerprintOf(inputs: ReportInputs): string {
  return sha256({
    solve: solveFingerprintOf(inputs),
    project: inputs.project.updatedAt.toISOString(),
    client: inputs.project.client?.updatedAt.toISOString() ?? null,
  });
}

/** The project and client names as the snapshot freezes them. */
export function namesOf(
  inputs: ReportInputs,
): Pick<BarOptimiserReport, 'project' | 'client'> {
  const { project } = inputs;
  return {
    project: { enName: project.enName, arName: project.arName ?? null },
    client: project.client
      ? {
          enName: project.client.enName,
          arName: project.client.arName ?? null,
        }
      : null,
  };
}

/** What the browser draws the PDF from, frozen at Generate
 * (docs/browser_pdf_planing.md §3, P6): the summary, every profile's
 * least-waste bars with their pieces' labels, the project and client
 * names, the date. */
export function reportSnapshotOf(
  inputs: ReportInputs,
  pieces: ProjectPieces,
  result: ProjectOptimisation<PieceRef>,
  generatedAt: Date,
): BarOptimiserReport {
  return {
    generatedAt: generatedAt.toISOString(),
    ...namesOf(inputs),
    summary: summaryOf(inputs, pieces, result),
    plans: result.profiles.map((p) => ({
      profile: p.profile,
      profileNo: profileNoOf(inputs, p.profile),
      member: p.member,
      best: p.best
        ? {
            mix: { ...p.best.mix },
            wastePct: p.best.wastePct,
            piecesMm: p.best.piecesMm,
            bars: p.best.bars.map((bar) => ({
              stockMm: bar.stockMm,
              wasteMm: bar.wasteMm,
              offcutMm: bar.offcutMm,
              pieces: bar.pieces.map((piece) => ({
                lengthMm: piece.lengthMm,
                windowName: piece.ref.windowName,
                member: piece.ref.member,
                at: piece.ref.at,
              })),
            })),
          }
        : null,
    })),
    panelCounts: Object.fromEntries(
      inputs.windows.map((w) => [w.id, w.panels.length]),
    ),
  };
}

function sha256(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function windowStampsOf(inputs: ReportInputs): Record<string, string> {
  return Object.fromEntries(inputs.windows.map((w) => [w.id, w.updatedAt]));
}

/** Windows added, removed or edited between two stamp sets (D15). */
export function changedWindowCount(
  before: Record<string, string> | null,
  now: Record<string, string>,
): number {
  if (!before) return 0;
  let changed = 0;
  for (const [id, stamp] of Object.entries(now)) {
    if (before[id] !== stamp) changed++;
  }
  for (const id of Object.keys(before)) {
    if (!(id in now)) changed++;
  }
  return changed;
}

export interface ProjectPieces {
  pieces: ProjectPiece<PieceRef>[];
  skipped: BarOptimiserSummary['skipped'];
}

/** Every window through the cut list (× its quantity). A panel whose
 * frame profile is gone draws as "no frame picked" (systemType null). */
export function buildProjectPieces(inputs: ReportInputs): ProjectPieces {
  const out: ProjectPieces = { pieces: [], skipped: [] };
  for (const window of inputs.windows) {
    const facts = window.panels.map((panel) => {
      const frame = inputs.profiles.get(panel.frameProfile);
      return {
        systemType: frame?.systemType ?? null,
        flyScreenAllowed: frame?.acceptsFlyScreen ?? false,
      };
    });
    const list = buildCutList({
      panels: window.panels,
      facts,
      quantity: window.quantity,
    });
    for (const piece of list.pieces) {
      out.pieces.push({
        profile: piece.profile,
        member: piece.member,
        lengthMm: piece.lengthMm,
        count: piece.count,
        ref: {
          windowId: window.id,
          windowName: window.name,
          member: piece.member,
          at: piece.at,
        },
      });
    }
    for (const part of list.skipped) {
      out.skipped.push({
        windowId: window.id,
        windowName: window.name,
        member: part.member,
        at: part.at,
      });
    }
  }
  return out;
}

export function profileNoOf(inputs: ReportInputs, ref: string): string | null {
  return inputs.profiles.get(ref)?.profileNo ?? null;
}

/** What the screen shows and the cache keeps (no bars: those go into
 * the PDF). */
export function summaryOf(
  inputs: ReportInputs,
  pieces: ProjectPieces,
  result: ProjectOptimisation<PieceRef>,
): BarOptimiserSummary {
  const totals = (plan: ReportPlanTotals): ReportPlanTotals => ({
    barCount: plan.barCount,
    boughtMm: plan.boughtMm,
    wasteMm: plan.wasteMm,
    wastePct: plan.wastePct,
  });
  const singleOf = (single: Record<number, ReportPlanTotals | null>) =>
    Object.fromEntries(
      Object.entries(single).map(([length, plan]) => [
        length,
        plan ? totals(plan) : null,
      ]),
    );
  const bestOf = (plan: CutPlan<PieceRef> | null) =>
    plan ? { ...totals(plan), mix: { ...plan.mix } } : null;

  return {
    stockLengthsMm: inputs.settings.stockLengthsMm,
    kerfMm: inputs.settings.kerfMm,
    endTrimMm: inputs.settings.endTrimMm,
    windowCount: inputs.windows.length,
    unitCount: inputs.windows.reduce((n, w) => n + w.quantity, 0),
    total: {
      ...totals(result.total),
      mix: { ...result.total.mix },
      pieceCount: result.total.pieceCount,
    },
    members: result.members.map((m) => ({
      member: m.member,
      pieceCount: m.pieceCount,
      profiles: m.profiles,
      single: singleOf(m.single),
      best: { ...totals(m.best), mix: { ...m.best.mix } },
    })),
    profiles: result.profiles.map((p) => ({
      profile: p.profile,
      profileNo: profileNoOf(inputs, p.profile),
      member: p.member,
      pieceCount: p.pieceCount,
      single: singleOf(p.single),
      best: bestOf(p.best),
      tooLong: p.tooLong.map((t) => ({
        lengthMm: t.lengthMm,
        count: t.count,
        windowName: t.ref.windowName,
        at: t.ref.at,
      })),
    })),
    skipped: pieces.skipped,
    approximate: true,
  };
}

/** One line per member group that has pieces, all waiting: a new solve's
 * progress (docs/browser_solve_planing.md B5). */
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
