import { createHash } from 'node:crypto';
import { In, type EntityManager, type Repository } from 'typeorm';
import { LookupScope, parseScopedRef } from '@repo/types/company-lookups';
import type { SystemType } from '@repo/types/lookups';
import {
  DEFAULT_CUTTING_SETTINGS,
  stockLengthsOf,
  type BarOptimiserReport,
  type BarOptimiserReportGoesTo,
  type BarOptimiserSummary,
  type ReportColorPair,
  type ReportPieceAt,
  type ReportPlanTotals,
  type ReportProgressGroup,
} from '@repo/types/reports';
import type { WindowDetail } from '@repo/types/windows';
import { buildCutList, type CutMember } from '@repo/geometry/cut-list';
import { OPTIMISER_VERSION } from '@repo/bar-optimiser/version';
import { PLACEHOLDER_METRICS } from '@repo/geometry/profile-metrics';
import type { Color } from '../../database/control-plane/entities/color.entity';
import type { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import type { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { CompanyColor } from '../../database/tenant/entities/company-color.entity';
import { CompanySystemCatalog } from '../../database/tenant/entities/company-system-catalog.entity';
import { CompanySystemProfile } from '../../database/tenant/entities/company-system-profile.entity';
import { CuttingSettingsRow } from '../../database/tenant/entities/cutting-settings.entity';
import { CompanyProfileRow } from '../../database/tenant/entities/company-profile.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { loadProjectWindows } from '../windows/windows.service';
import type { CutBar, CutPlan } from '@repo/bar-optimiser/optimise';
import {
  MEMBER_ORDER,
  profileQueue,
  type ProjectOptimisation,
  type ProjectPiece,
  type WidthOf,
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
 * the PDF from a saved snapshot (docs/browser_pdf_planing.md §4). 5: the
 * totals count real metal, mitred ends as waste
 * (docs/mitre_cuts_planing.md §7). 6: waste as an area, mitre ends
 * and saw cuts drawn (docs/bar_waste_area_planing.md). 7: pieces share
 * a bar only within one colour pair (docs/report_colours_planing.md). */
export const REPORT_VERSION = 7;

export interface PieceRef {
  windowId: string;
  windowName: string;
  member: CutMember;
  at: ReportPieceAt;
  /** Each end's mitre triangle along the bar (cut-list `endsMm`). */
  endsMm: [number, number];
}

interface ProfileFacts {
  profileNo: string;
  systemType: SystemType | null;
  acceptsFlyScreen: boolean;
  /** mm; null = the placeholder width (docs/mitre_cuts_planing.md §4). */
  faceWidthMm: number | null;
  /** Profile + catalogue `updated_at`: part of the fingerprint. */
  stamp: string;
}

interface ColorFacts {
  code: string;
  hex: string;
  /** `updated_at`: part of the snapshot fingerprint. */
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
  /** Every colour ref the windows' panels use. Absent = the row is gone. */
  colors: Map<string, ColorFacts>;
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
  colors: Repository<Color>;
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
    colors: await loadColors(manager, platform, colorRefsOf(windows)),
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

function colorRefsOf(windows: WindowDetail[]): Set<string> {
  const refs = new Set<string>();
  for (const panel of windows.flatMap((w) => w.panels)) {
    if (panel.interiorColor) refs.add(panel.interiorColor);
    if (panel.exteriorColor) refs.add(panel.exteriorColor);
  }
  return refs;
}

async function loadColors(
  manager: EntityManager,
  platform: PlatformRepos,
  refs: Set<string>,
): Promise<Map<string, ColorFacts>> {
  const ids = { platform: [] as string[], company: [] as string[] };
  for (const ref of refs) {
    const { scope, id } = parseScopedRef(ref);
    ids[scope === LookupScope.PLATFORM ? 'platform' : 'company'].push(id);
  }
  const rows = [
    ...(ids.platform.length
      ? await platform.colors.find({ where: { id: In(ids.platform) } })
      : []
    ).map((c) => [LookupScope.PLATFORM, c] as const),
    ...(ids.company.length
      ? await manager.find(CompanyColor, { where: { id: In(ids.company) } })
      : []
    ).map((c) => [LookupScope.COMPANY, c] as const),
  ];
  return new Map(
    rows.map(([scope, c]) => [
      `${scope}:${c.id}`,
      { code: c.code, hex: c.hex, stamp: c.updatedAt.toISOString() },
    ]),
  );
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
      faceWidthMm: p.faceWidthMm,
      stamp: stampOf(p, cat),
    });
  }
  for (const p of companyProfiles) {
    const cat = catalog(p.platformCatalogId, p.companyCatalogId);
    facts.set(`${LookupScope.COMPANY}:${p.id}`, {
      profileNo: p.profileNo,
      systemType: cat?.systemType ?? null,
      acceptsFlyScreen: p.acceptsFlyScreen,
      faceWidthMm: p.faceWidthMm,
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
    // A renamed colour code only re-saves the snapshot (report colours §4).
    colors: [...colorRefsOf(inputs.windows)]
      .sort()
      .map((ref) => [ref, inputs.colors.get(ref)?.stamp ?? 'missing']),
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
  const widthOf = widthsOf(inputs, pieces);
  return {
    generatedAt: generatedAt.toISOString(),
    ...namesOf(inputs),
    summary: summaryOf(inputs, pieces, result),
    plans: byColorCode(inputs, result.profiles).map((p) => ({
      profile: profileRefOf(p.profile),
      profileNo: profileNoOf(inputs, p.profile),
      colors: colorsOf(inputs, p.profile),
      member: p.member,
      faceWidthMm: widthOf(p.profile),
      best: p.best
        ? {
            mix: { ...p.best.mix },
            wastePct: p.best.wastePct,
            wasteMm2: Math.round(p.best.wasteMm * widthOf(p.profile)),
            piecesMm: p.best.piecesMm,
            bars: patternsOf(p.best.bars).map(({ bar, count, goesTo }) => ({
              stockMm: bar.stockMm,
              wasteMm: bar.wasteMm,
              wasteMm2: Math.round(bar.wasteMm * widthOf(p.profile)),
              offcutMm: bar.offcutMm,
              pieces: bar.pieces.map((piece) => ({
                lengthMm: piece.lengthMm,
                endsMm: piece.ref.endsMm,
                windowName: piece.ref.windowName,
                member: piece.ref.member,
                at: piece.ref.at,
              })),
              count,
              goesTo,
            })),
          }
        : null,
    })),
    panelCounts: Object.fromEntries(
      inputs.windows.map((w) => [w.id, w.panels.length]),
    ),
  };
}

/** A plan's bars grouped as the PDF draws them
 * (docs/bar_patterns_planing.md G1, docs/report_speed_planing.md §5):
 * the same stock and the same pieces in order, each with the same length
 * and ends. Labels don't split a pattern; `goesTo` counts them. In the
 * order of each pattern's first bar. */
export function patternsOf(bars: CutBar<PieceRef>[]): {
  bar: CutBar<PieceRef>;
  count: number;
  goesTo: BarOptimiserReportGoesTo[];
}[] {
  const byCut = new Map<
    string,
    {
      bar: CutBar<PieceRef>;
      count: number;
      goesTo: Map<string, BarOptimiserReportGoesTo>;
    }
  >();
  for (const bar of bars) {
    const key = [
      bar.stockMm,
      ...bar.pieces.map((p) => `${p.lengthMm}/${p.ref.endsMm.join('/')}`),
    ].join(':');
    const group = byCut.get(key) ?? {
      bar,
      count: 0,
      goesTo: new Map<string, BarOptimiserReportGoesTo>(),
    };
    group.count++;
    for (const { ref } of bar.pieces) {
      const where = JSON.stringify([ref.windowName, ref.member, ref.at]);
      const seen = group.goesTo.get(where);
      if (seen) seen.count++;
      else {
        group.goesTo.set(where, {
          windowName: ref.windowName,
          member: ref.member,
          at: ref.at,
          count: 1,
        });
      }
    }
    byCut.set(key, group);
  }
  return [...byCut.values()].map((g) => ({
    bar: g.bar,
    count: g.count,
    goesTo: [...g.goesTo.values()],
  }));
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

/** A bar group (docs/report_colours_planing.md §3): one profile in one
 * interior + exterior colour pair (scoped refs, empty = none picked).
 * Only a group's pieces may share a bar, so it is the key the whole solve
 * path uses where it says "profile" — the optimiser treats it as opaque. */
export function barGroupOf(
  profile: string,
  interior: string | null | undefined,
  exterior: string | null | undefined,
): string {
  return `${profile}|${interior ?? ''}|${exterior ?? ''}`;
}

/** The profile ref a bar group is cut from. */
export function profileRefOf(group: string): string {
  return group.split('|')[0];
}

/** A bar group's colour pair with today's codes. */
export function colorsOf(
  inputs: Pick<ReportInputs, 'colors'>,
  group: string,
): ReportColorPair {
  const [, interior, exterior] = group.split('|');
  const side = (ref: string | undefined) => {
    if (!ref) return null;
    const facts = inputs.colors.get(ref);
    return { ref, code: facts?.code ?? null, hex: facts?.hex ?? null };
  };
  return { interior: side(interior), exterior: side(exterior) };
}

/** The same colours with today's codes: what a refresh re-saves. */
export function recolored(
  inputs: Pick<ReportInputs, 'colors'>,
  pair: ReportColorPair,
): ReportColorPair {
  return colorsOf(
    inputs,
    barGroupOf('', pair.interior?.ref, pair.exterior?.ref),
  );
}

/** Within one profile, its colour pairs by code, no colour last
 * (report colours §3). A profile's groups sit together already: the
 * queue sorts by the group key, which starts with the profile ref. */
function byColorCode<T extends { profile: string }>(
  inputs: Pick<ReportInputs, 'colors'>,
  rows: T[],
): T[] {
  const label = (group: string) => {
    const { interior, exterior } = colorsOf(inputs, group);
    const last = '\uffff';
    return `${interior?.code ?? last}|${exterior?.code ?? last}`;
  };
  const runs: T[][] = [];
  for (const row of rows) {
    const run = runs.at(-1);
    if (run && profileRefOf(run[0].profile) === profileRefOf(row.profile)) {
      run.push(row);
    } else runs.push([row]);
  }
  return runs.flatMap((run) =>
    run
      .map((row) => ({ row, label: label(row.profile) }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(({ row }) => row),
  );
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
      faceWidthOf: (ref) => inputs.profiles.get(ref)?.faceWidthMm ?? null,
    });
    for (const piece of list.pieces) {
      // Sash, divider and bead take their panel's colours (C3).
      const panel = window.panels[piece.at.panelIndex];
      out.pieces.push({
        profile: barGroupOf(
          piece.profile,
          panel?.interiorColor,
          panel?.exteriorColor,
        ),
        member: piece.member,
        lengthMm: piece.lengthMm,
        metalMm: piece.metalMm,
        count: piece.count,
        ref: {
          windowId: window.id,
          windowName: window.name,
          member: piece.member,
          at: piece.at,
          endsMm: piece.endsMm,
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

/** The placeholder face width of each member group, mm. */
const PLACEHOLDER_WIDTH: Record<CutMember, number> = {
  frame: PLACEHOLDER_METRICS.frameFace,
  sash: PLACEHOLDER_METRICS.sashFace,
  divider: PLACEHOLDER_METRICS.dividerFace,
  bead: PLACEHOLDER_METRICS.beadFace,
};

/** Each bar group's face width for the waste areas
 * (docs/bar_waste_area_planing.md §3): its profile's own, else the
 * placeholder of the member group it counts under. */
export function widthsOf(inputs: ReportInputs, pieces: ProjectPieces): WidthOf {
  const member = new Map(
    profileQueue(pieces.pieces).map((q) => [q.profile, q.member]),
  );
  return (group) =>
    inputs.profiles.get(profileRefOf(group))?.faceWidthMm ??
    PLACEHOLDER_WIDTH[member.get(group) ?? 'frame'];
}

/** A profile's number; takes a profile ref or a bar group. */
export function profileNoOf(inputs: ReportInputs, ref: string): string | null {
  return inputs.profiles.get(profileRefOf(ref))?.profileNo ?? null;
}

/** What the screen shows and the cache keeps (no bars: those go into
 * the PDF). */
export function summaryOf(
  inputs: ReportInputs,
  pieces: ProjectPieces,
  result: ProjectOptimisation<PieceRef>,
): BarOptimiserSummary {
  const widthOf = widthsOf(inputs, pieces);
  // A group's or the project's totals carry their area; one profile's
  // plan is its length × its width.
  const totals = (
    plan: Omit<ReportPlanTotals, 'wasteMm2' | 'boughtMm2'> & {
      wasteMm2?: number;
      boughtMm2?: number;
    },
    widthMm = 1,
  ): ReportPlanTotals => ({
    barCount: plan.barCount,
    boughtMm: plan.boughtMm,
    wasteMm: plan.wasteMm,
    wasteMm2: plan.wasteMm2 ?? Math.round(plan.wasteMm * widthMm),
    boughtMm2: plan.boughtMm2 ?? Math.round(plan.boughtMm * widthMm),
    wastePct: plan.wastePct,
  });
  const singleOf = (
    single: Record<
      number,
      Omit<ReportPlanTotals, 'wasteMm2' | 'boughtMm2'> | null
    >,
    widthMm?: number,
  ) =>
    Object.fromEntries(
      Object.entries(single).map(([length, plan]) => [
        length,
        plan ? totals(plan, widthMm) : null,
      ]),
    );
  const bestOf = (plan: CutPlan<PieceRef> | null, widthMm: number) =>
    plan ? { ...totals(plan, widthMm), mix: { ...plan.mix } } : null;

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
      profiles: [...new Set(m.profiles.map(profileRefOf))],
      single: singleOf(m.single),
      best: { ...totals(m.best), mix: { ...m.best.mix } },
    })),
    profiles: byColorCode(inputs, result.profiles).map((p) => ({
      profile: profileRefOf(p.profile),
      profileNo: profileNoOf(inputs, p.profile),
      colors: colorsOf(inputs, p.profile),
      member: p.member,
      pieceCount: p.pieceCount,
      single: singleOf(p.single, widthOf(p.profile)),
      best: bestOf(p.best, widthOf(p.profile)),
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
export function initialProgress(
  pieces: ProjectPieces,
  /** Profiles reused from the last solve: done from the start (S1). */
  reused: ReadonlySet<string> = new Set(),
): ReportProgressGroup[] {
  const queue = profileQueue(pieces.pieces);
  return MEMBER_ORDER.flatMap((member) => {
    const mine = queue.filter((q) => q.member === member);
    const done = mine.filter((q) => reused.has(q.profile)).length;
    return mine.length
      ? [
          {
            member,
            state:
              done === mine.length ? ('done' as const) : ('waiting' as const),
            profilesDone: done,
            profilesTotal: mine.length,
            currentProfile: null,
          },
        ]
      : [];
  });
}

/** Each bar group's plan key (docs/report_speed_planing.md §6): everything
 * its plans depend on — the optimiser, the stock lengths, kerf and end
 * trim, and its pieces' lengths with how many of each. Not which window a
 * piece is from: the optimiser packs by length. Same key = same plans. */
export function planKeysOf(
  inputs: ReportInputs,
  pieces: ProjectPieces,
): Map<string, string> {
  const byProfile = new Map<string, Map<number, number>>();
  for (const piece of pieces.pieces) {
    const lengths = byProfile.get(piece.profile) ?? new Map<number, number>();
    lengths.set(
      piece.lengthMm,
      (lengths.get(piece.lengthMm) ?? 0) + piece.count,
    );
    byProfile.set(piece.profile, lengths);
  }
  const { stockLengthsMm, kerfMm, endTrimMm } = inputs.settings;
  return new Map(
    [...byProfile].map(([profile, lengths]) => [
      profile,
      sha256({
        optimiser: OPTIMISER_VERSION,
        stock: [...stockLengthsMm].sort((a, b) => a - b),
        kerfMm,
        endTrimMm,
        pieces: [...lengths].sort(([a], [b]) => a - b),
      }),
    ]),
  );
}
