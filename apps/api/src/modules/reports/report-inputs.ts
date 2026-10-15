import { createHash } from 'node:crypto';
import { In, type EntityManager, type Repository } from 'typeorm';
import { LookupScope, parseScopedRef } from '@repo/types/company-lookups';
import type { SystemType } from '@repo/types/lookups';
import {
  DEFAULT_CUTTING_SETTINGS,
  stockLengthsOf,
  type BarOptimiserSummary,
  type ReportLanguage,
  type ReportPieceAt,
  type ReportPlanTotals,
} from '@repo/types/reports';
import type { WindowDetail } from '@repo/types/windows';
import { buildCutList, type CutMember } from '@repo/geometry/cut-list';
import type { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import type { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { CompanySystemCatalog } from '../../database/tenant/entities/company-system-catalog.entity';
import { CompanySystemProfile } from '../../database/tenant/entities/company-system-profile.entity';
import { CuttingSettingsRow } from '../../database/tenant/entities/cutting-settings.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { loadProjectWindows } from '../windows/windows.service';
import type { CutPlan } from './bar-optimiser/optimise';
import type {
  ProjectOptimisation,
  ProjectPiece,
} from './bar-optimiser/project';

// Everything a bar optimiser report is made from, read in one tenant
// transaction, and what follows from it: the fingerprint that says
// whether a cached report is still current (docs/reports_planing.md §6,
// D14), the pieces handed to the optimiser, and the stored summary.

/** Bump when the cut-list rules, the optimiser or the PDF change in a way
 * that should make every cached report stale. */
export const REPORT_VERSION = 1;

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

  return {
    project,
    windows,
    settings,
    profiles: await loadProfiles(manager, platform, profileRefsOf(windows)),
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

/** sha-256 over everything the report is made from (D14): the windows,
 * the project and its client, the settings, every profile used and its
 * catalogue, the language, and `REPORT_VERSION`. */
export function fingerprintOf(
  inputs: ReportInputs,
  language: ReportLanguage,
): string {
  const body = {
    v: REPORT_VERSION,
    language,
    project: inputs.project.updatedAt.toISOString(),
    client: inputs.project.client?.updatedAt.toISOString() ?? null,
    settings: inputs.settings.updatedAt?.toISOString() ?? 'default',
    windows: Object.entries(windowStampsOf(inputs)).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    profiles: [...profileRefsOf(inputs.windows)]
      .sort()
      .map((ref) => [ref, inputs.profiles.get(ref)?.stamp ?? 'missing']),
  };
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
