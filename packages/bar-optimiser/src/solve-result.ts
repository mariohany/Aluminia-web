import type { CutMember } from '@repo/geometry/cut-list';
import {
  capacityOf,
  toPlan,
  usableLengths,
  type CutPlan,
  type OptimiserSettings,
  type ProfileOptimisation,
} from './optimise.ts';
import {
  assembleProject,
  profileQueue,
  type ProfileResult,
  type ProjectOptimisation,
  type ProjectPiece,
  type WidthOf,
} from './project.ts';

// A solve made in the browser and checked by the API
// (docs/browser_solve_planing.md §5). The API hands the browser the
// project's piece lines; a line's number is its position in that list.
// The browser sends back only bars of line numbers: no lengths, labels or
// totals. The API checks them against its own lines and rebuilds every
// plan and total itself, so a buggy or edited browser can't print a plan
// that misses a piece, overfills a bar or claims numbers it didn't cut.
// What it can't check is that a plan is the least waste.

/** A piece line as the browser gets it: one profile, one length, `count`
 * pieces. */
export interface SolvePiece {
  profile: string;
  member: CutMember;
  lengthMm: number;
  count: number;
}

/** One bar: its stock length and the line numbers cut from it (a line
 * appears once per piece). */
export interface SolvedBar {
  stockMm: number;
  pieces: number[];
  /** How many bars are cut exactly like this; absent = 1
   * (docs/report_speed_planing.md §5: a 150-copy project sent 660 KB). */
  count?: number;
}

/** A plan's bars, or `null` where the optimiser had none. */
export type SolvedPlan = SolvedBar[] | null;

export interface SolvedProfile {
  profile: string;
  best: SolvedPlan;
  /** Keyed by stock length in mm, every usable length present (D2). */
  single: Record<string, SolvedPlan>;
}

export interface SolveResult {
  profiles: SolvedProfile[];
}

/** The lines as the optimiser takes them in the browser: the line number
 * is the ref, so the plans come back as line numbers. */
export function solveInput(lines: SolvePiece[]): ProjectPiece<number>[] {
  return lines.map((line, i) => ({ ...line, ref: i }));
}

/** One profile's optimiser output in the shape the API takes. */
export function solvedProfileOf(
  profile: string,
  result: ProfileOptimisation<number>,
): SolvedProfile {
  const bars = (plan: CutPlan<number> | null): SolvedPlan =>
    plan ? collapseBars(plan) : null;
  return {
    profile,
    best: bars(result.best),
    single: Object.fromEntries(
      Object.entries(result.single).map(([length, plan]) => [
        length,
        bars(plan),
      ]),
    ),
  };
}

/** A plan's bars, each distinct one once with how many there are, in
 * the order they first appear. */
function collapseBars(plan: CutPlan<number>): SolvedBar[] {
  const byCut = new Map<string, SolvedBar>();
  for (const bar of plan.bars) {
    const pieces = bar.pieces.map((p) => p.ref);
    const key = `${bar.stockMm}:${pieces.join(',')}`;
    const seen = byCut.get(key);
    if (seen) seen.count = (seen.count ?? 1) + 1;
    else byCut.set(key, { stockMm: bar.stockMm, pieces });
  }
  return [...byCut.values()];
}

/** Why a solve was refused: the API answers 422 with the message. */
export class SolveRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SolveRefused';
  }
}

/** Kerf sums of fractional (arc) lengths may land a hair past the room. */
const EPSILON_MM = 1e-6;

/**
 * Checks a browser's plans against the API's own piece lines and rebuilds
 * the project's optimisation from them. Throws `SolveRefused` when:
 * a profile is missing, unknown or sent twice; a plan doesn't cut every
 * cuttable piece of its profile exactly once (too-long pieces are the
 * API's own list and must not appear); a bar uses a length that isn't
 * allowed there or is overfilled; a single-length plan is missing where
 * every piece fits that length, or present where one doesn't; or the
 * best plan buys more metal than a single-length one.
 */
export function validateSolve<T>(
  lines: ProjectPiece<T>[],
  settings: OptimiserSettings,
  result: SolveResult,
  /** Each profile's face width, for the waste areas (`assembleProject`). */
  widthOf?: WidthOf,
): ProjectOptimisation<T> {
  const lengths = usableLengths(settings);
  const capOf = (stockMm: number) => capacityOf(stockMm, settings);
  const maxCap = lengths.length ? capOf(lengths[0]) : 0;
  const sizeOf = (line: number) => lines[line].lengthMm + settings.kerfMm;
  // The totals count each line's real metal, as the optimiser does.
  const metalByRef = new Map(lines.map((line) => [line.ref, line.metalMm]));
  const pieceMetal = (ref: T) => metalByRef.get(ref);

  const sent = new Map<string, SolvedProfile>();
  for (const solved of result.profiles) {
    if (sent.has(solved.profile)) {
      throw new SolveRefused(`Profile ${solved.profile} was sent twice.`);
    }
    sent.set(solved.profile, solved);
  }
  const queue = profileQueue(solveInput(lines));
  for (const name of sent.keys()) {
    if (!queue.some((q) => q.profile === name)) {
      throw new SolveRefused(`Profile ${name} isn't in this project.`);
    }
  }

  const profiles: ProfileResult<T>[] = queue.map(
    ({ profile, member, list }) => {
      const solved = sent.get(profile);
      if (!solved) throw new SolveRefused(`Profile ${profile} is missing.`);
      const counted = list.filter((p) => p.count > 0 && p.lengthMm > 0);
      const cuttable = counted.filter((p) => sizeOf(p.ref) <= maxCap);
      const need = new Map(cuttable.map((p) => [p.ref, p.count]));

      const check = (
        bars: SolvedBar[],
        allowed: number[],
        label: string,
      ): CutPlan<T> => {
        const refuse = (why: string) =>
          new SolveRefused(`${profile}, ${label}: ${why}`);
        const used = new Map<number, number>();
        // Each distinct bar is checked once and counted `count` times;
        // bars are only multiplied out once every piece count holds, so a
        // forged count can't make thousands of them.
        for (const bar of bars) {
          if (!allowed.includes(bar.stockMm)) {
            throw refuse(`${bar.stockMm} mm isn't an allowed stock length.`);
          }
          if (!bar.pieces.length) throw refuse('a bar has no pieces.');
          const times = bar.count ?? 1;
          if (!Number.isInteger(times) || times < 1) {
            throw refuse(`a bar is cut ${times}×.`);
          }
          let room = capOf(bar.stockMm);
          for (const line of bar.pieces) {
            if (!need.has(line)) {
              throw refuse(`piece line ${line} isn't cut from this profile.`);
            }
            used.set(line, (used.get(line) ?? 0) + times);
            room -= sizeOf(line);
          }
          if (room < -EPSILON_MM) {
            throw refuse(`a ${bar.stockMm} mm bar is overfilled.`);
          }
        }
        for (const [line, count] of need) {
          const cut = used.get(line) ?? 0;
          if (cut !== count) {
            throw refuse(`piece line ${line} is cut ${cut}×, needs ${count}×.`);
          }
        }
        const raw = bars.flatMap((bar) => {
          const one = {
            stockMm: bar.stockMm,
            pieces: bar.pieces.map((line) => ({
              lengthMm: lines[line].lengthMm,
              ref: lines[line].ref,
            })),
          };
          return Array.from({ length: bar.count ?? 1 }, () => ({
            ...one,
            pieces: [...one.pieces],
          }));
        });
        return toPlan(raw, settings, pieceMetal);
      };

      let best: CutPlan<T> | null = null;
      if (!cuttable.length || !lengths.length) {
        if (solved.best !== null) {
          throw new SolveRefused(`${profile}: has no plan to cut.`);
        }
      } else {
        if (solved.best === null) {
          throw new SolveRefused(`${profile}: the best plan is missing.`);
        }
        best = check(solved.best, lengths, 'best plan');
      }

      const keys = Object.keys(solved.single);
      if (
        keys.length !== lengths.length ||
        lengths.some((l) => !(String(l) in solved.single))
      ) {
        throw new SolveRefused(
          `${profile}: the single-length plans don't match the stock lengths.`,
        );
      }
      const single: Record<number, CutPlan<T> | null> = {};
      for (const length of lengths) {
        const plan = solved.single[String(length)];
        const fits =
          cuttable.length > 0 &&
          cuttable.every((p) => sizeOf(p.ref) <= capOf(length));
        if (!fits) {
          if (plan !== null) {
            throw new SolveRefused(
              `${profile}: ${length} mm can't hold every piece, yet has a plan.`,
            );
          }
          single[length] = null;
          continue;
        }
        if (plan === null) {
          throw new SolveRefused(
            `${profile}: the ${length} mm plan is missing.`,
          );
        }
        single[length] = check(plan, [length], `${length} mm plan`);
        if (best && best.boughtMm > single[length].boughtMm + EPSILON_MM) {
          throw new SolveRefused(
            `${profile}: the best plan buys more metal than the ${length} mm one.`,
          );
        }
      }

      return {
        profile,
        member,
        best,
        single,
        tooLong: counted
          .filter((p) => sizeOf(p.ref) > maxCap)
          .map((p) => lines[p.ref]),
        pieceCount: list.reduce((sum, p) => sum + p.count, 0),
      };
    },
  );

  return assembleProject(profiles, settings, widthOf);
}
