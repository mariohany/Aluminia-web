import type { CutMember } from '@repo/geometry/cut-list';
import {
  optimiseProfile,
  type CutPlan,
  type OptimiserPiece,
  type OptimiserSettings,
  type ProfileOptimisation,
} from './optimise.ts';

// A whole project through the optimiser: one run per profile (D4: the
// grouping key is the profile; colour can join it later), rolled up into
// the four member groups the report and its progress card show
// (docs/reports_planing.md §4, D22).

/** The order profiles are optimised and member groups listed in. */
export const MEMBER_ORDER: CutMember[] = ['frame', 'sash', 'divider', 'bead'];

export interface ProjectPiece<T> extends OptimiserPiece<T> {
  profile: string;
  member: CutMember;
}

export interface ProfileResult<T> extends ProfileOptimisation<T> {
  profile: string;
  /** The member group the profile counts under: the member most of its
   * pieces are, when one profile serves two (say frame and transom). Its
   * bars aren't split between groups. */
  member: CutMember;
  pieceCount: number;
}

export interface PlanTotals {
  barCount: number;
  boughtMm: number;
  wasteMm: number;
  wastePct: number;
}

export interface MemberTotals {
  member: CutMember;
  profiles: string[];
  pieceCount: number;
  /** Every profile of the group on this length alone; `null` when some
   * profile's pieces don't fit it. */
  single: Record<number, PlanTotals | null>;
  /** The least-waste plans, mixed per profile. */
  best: PlanTotals & { mix: Record<number, number> };
}

export interface ProjectOptimisation<T> {
  profiles: ProfileResult<T>[];
  members: MemberTotals[];
  total: PlanTotals & { mix: Record<number, number>; pieceCount: number };
}

export interface ProgressHooks {
  onProfileStart?(step: ProgressStep): void;
  onProfileDone?(step: ProgressStep): void;
}

export interface ProgressStep {
  profile: string;
  member: CutMember;
  /** 0-based position among all profiles. */
  index: number;
  total: number;
}

export async function optimiseProject<T>(
  pieces: ProjectPiece<T>[],
  settings: OptimiserSettings,
  hooks: ProgressHooks = {},
): Promise<ProjectOptimisation<T>> {
  const queue = profileQueue(pieces);

  const profiles: ProfileResult<T>[] = [];
  for (const [index, { profile, list, member }] of queue.entries()) {
    const step = { profile, member, index, total: queue.length };
    hooks.onProfileStart?.(step);
    const result = await optimiseProfile(list, settings);
    profiles.push({
      ...result,
      profile,
      member,
      pieceCount: list.reduce((sum, p) => sum + p.count, 0),
    });
    hooks.onProfileDone?.(step);
  }
  return assembleProject(profiles, settings);
}

/** Every profile's result rolled up into the member groups and the
 * project total. Shared by a whole-project run and by the API, which
 * rebuilds a browser's plans after checking them
 * (docs/browser_solve_planing.md §5). */
export function assembleProject<T>(
  profiles: ProfileResult<T>[],
  settings: OptimiserSettings,
): ProjectOptimisation<T> {
  const lengths = [...new Set(settings.lengths)].sort((a, b) => b - a);
  const members = MEMBER_ORDER.flatMap((member) => {
    const own = profiles.filter((p) => p.member === member);
    if (!own.length) return [];
    const single: Record<number, PlanTotals | null> = {};
    for (const length of lengths) {
      const plans = own.map((p) => p.single[length] ?? null);
      single[length] = plans.every((p) => p !== null) ? sum(plans) : null;
    }
    const best = sum(own.map((p) => p.best));
    return [
      {
        member,
        profiles: own.map((p) => p.profile),
        pieceCount: own.reduce((n, p) => n + p.pieceCount, 0),
        single,
        best: { ...best, mix: mixOf(own.map((p) => p.best)) },
      },
    ];
  });

  const all = sum(profiles.map((p) => p.best));
  return {
    profiles,
    members,
    total: {
      ...all,
      mix: mixOf(profiles.map((p) => p.best)),
      pieceCount: profiles.reduce((n, p) => n + p.pieceCount, 0),
    },
  };
}

/** The profiles in the order they are optimised, each with the member
 * group it counts under — known before any solving, so the report job
 * can lay out its progress card up front. */
export function profileQueue<T>(
  pieces: ProjectPiece<T>[],
): { profile: string; member: CutMember; list: ProjectPiece<T>[] }[] {
  const byProfile = new Map<string, ProjectPiece<T>[]>();
  for (const piece of pieces) {
    const list = byProfile.get(piece.profile) ?? [];
    list.push(piece);
    byProfile.set(piece.profile, list);
  }
  return [...byProfile.entries()]
    .map(([profile, list]) => ({
      profile,
      list,
      member: majorityMember(list),
    }))
    .sort(
      (a, b) =>
        MEMBER_ORDER.indexOf(a.member) - MEMBER_ORDER.indexOf(b.member) ||
        a.profile.localeCompare(b.profile),
    );
}

function majorityMember<T>(list: ProjectPiece<T>[]): CutMember {
  const counts = new Map<CutMember, number>();
  for (const piece of list) {
    counts.set(piece.member, (counts.get(piece.member) ?? 0) + piece.count);
  }
  return [...counts.entries()].sort(
    (a, b) =>
      b[1] - a[1] || MEMBER_ORDER.indexOf(a[0]) - MEMBER_ORDER.indexOf(b[0]),
  )[0][0];
}

function sum<T>(plans: (CutPlan<T> | null)[]): PlanTotals {
  let barCount = 0;
  let boughtMm = 0;
  let wasteMm = 0;
  for (const plan of plans) {
    if (!plan) continue;
    barCount += plan.barCount;
    boughtMm += plan.boughtMm;
    wasteMm += plan.wasteMm;
  }
  return {
    barCount,
    boughtMm,
    wasteMm,
    wastePct: boughtMm ? (wasteMm / boughtMm) * 100 : 0,
  };
}

function mixOf<T>(plans: (CutPlan<T> | null)[]): Record<number, number> {
  const mix: Record<number, number> = {};
  for (const plan of plans) {
    for (const [length, n] of Object.entries(plan?.mix ?? {})) {
      mix[Number(length)] = (mix[Number(length)] ?? 0) + n;
    }
  }
  return mix;
}
