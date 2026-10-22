import highsLoader, { type Highs } from 'highs';

// The bar optimiser (docs/reports_planing.md §4): cut one profile's
// pieces out of stock bars, buying the least metal. No Nest; the report
// job calls it per profile.
//
// A bar of length L has L − 2·trim usable; every piece uses its length
// plus one kerf. Waste is everything bought that isn't a piece (D3):
// kerf, trim and every offcut. Minimising waste is minimising metal
// bought (the pieces are fixed). Lengths may be mixed within a profile
// (D2). The answer is the least waste the steps below can prove; every
// solver step has a time limit, and a profile none of them can prove
// gets the best plan found, unmarked (D21 amended 2026-10-22: Mario
// checks those plans himself).
//
// Method, cheapest first (bug-126):
// 1. The stock mixes with room for every piece, cheapest first: best-fit,
//    then an exact bar-by-bar search. The first mix the pieces really fit
//    is the proven optimum. Settles most profiles in milliseconds.
// 2. Column generation (Gilmore–Gomory, from Mario's cutting_optimizer.py):
//    HiGHS solves the linear program over cutting patterns, a knapsack
//    finds each next pattern. Its bound is the floor no plan can beat; an
//    integer program over the patterns gives a plan. Plan = floor: done.
// 3. Between floor and plan: the exact search on the mixes in between,
//    then the arc-flow integer program (Valério de Carvalho: a graph per
//    stock length, an arc per piece, one unit of flow per bar) — only
//    while its graph is small, since it is what ran out of WebAssembly
//    memory on many short lengths (bug-110, bug-126).

export interface OptimiserSettings {
  /** Stock lengths to try, mm. */
  lengths: number[];
  kerfMm: number;
  /** Cut off each end of a new bar. */
  endTrimMm: number;
}

export interface OptimiserPiece<T> {
  lengthMm: number;
  count: number;
  ref: T;
}

export interface CutBar<T> {
  stockMm: number;
  /** In cutting order, longest first. */
  pieces: { lengthMm: number; ref: T }[];
  /** Everything of this bar not in a piece: trim, kerfs, offcut. */
  wasteMm: number;
  /** The piece of bar left after the last cut, before the end trim. */
  offcutMm: number;
}

export interface CutPlan<T> {
  /** Bars per stock length, e.g. `{ 6500: 4, 6000: 7 }`. */
  mix: Record<number, number>;
  /** Longest stock first, then fullest first. */
  bars: CutBar<T>[];
  barCount: number;
  boughtMm: number;
  /** Σ piece lengths. */
  piecesMm: number;
  wasteMm: number;
  /** wasteMm / boughtMm × 100. */
  wastePct: number;
}

export interface ProfileOptimisation<T> {
  /** The least-waste plan over every stock length, mixed. `null` when
   * nothing can be cut (no pieces, or all too long). */
  best: CutPlan<T> | null;
  /** Each length on its own, for comparison. `null` where a piece
   * doesn't fit that length. */
  single: Record<number, CutPlan<T> | null>;
  /** Pieces longer than the longest usable bar: can't be cut, listed. */
  tooLong: OptimiserPiece<T>[];
}

let solver: Promise<Highs> | null = null;
let locateWasm: ((file: string) => string) | undefined;

/** Where HiGHS finds its `.wasm`. Node finds it next to the module; a
 * browser bundle passes the URL its bundler gave the file
 * (docs/browser_solve_planing.md §4.1). Call before the first solve. */
export function configureSolver(options: {
  locateFile?: (file: string) => string;
}): void {
  locateWasm = options.locateFile;
}

/** HiGHS is a ~4 MB WebAssembly module: loaded once, on first use. */
function getSolver(): Promise<Highs> {
  solver ??= highsLoader(locateWasm ? { locateFile: locateWasm } : undefined);
  return solver;
}

interface PieceType<T> {
  lengthMm: number;
  /** Length + kerf: what it takes out of a bar. */
  size: number;
  refs: T[];
}

export async function optimiseProfile<T>(
  pieces: OptimiserPiece<T>[],
  settings: OptimiserSettings,
): Promise<ProfileOptimisation<T>> {
  const lengths = usableLengths(settings);
  const maxCap = lengths.length ? lengths[0] - 2 * settings.endTrimMm : 0;

  const byLength = new Map<number, PieceType<T>>();
  const tooLong: OptimiserPiece<T>[] = [];
  for (const piece of pieces) {
    if (!(piece.count > 0) || !(piece.lengthMm > 0)) continue;
    const size = piece.lengthMm + settings.kerfMm;
    if (size > maxCap) {
      tooLong.push(piece);
      continue;
    }
    const type = byLength.get(piece.lengthMm) ?? {
      lengthMm: piece.lengthMm,
      size,
      refs: [],
    };
    for (let i = 0; i < piece.count; i++) type.refs.push(piece.ref);
    byLength.set(piece.lengthMm, type);
  }
  const types = [...byLength.values()].sort((a, b) => b.size - a.size);

  const highs = await getSolver();
  const single: Record<number, CutPlan<T> | null> = {};
  for (const length of lengths) {
    single[length] = solve(highs, types, [length], settings);
  }
  const best =
    lengths.length > 1
      ? solve(highs, types, lengths, settings)
      : (single[lengths[0]] ?? null);
  return { best, single, tooLong };
}

/** The stock lengths a plan may use: distinct, longer than both end
 * trims, longest first. */
export function usableLengths(settings: OptimiserSettings): number[] {
  return [...new Set(settings.lengths)]
    .filter((l) => l > 2 * settings.endTrimMm)
    .sort((a, b) => b - a);
}

interface Arc {
  stock: number; // index into the stock lengths
  from: string;
  to: string;
  type: number; // index into types; -1 = the rest of the bar (offcut)
}

/** The least-metal plan for these piece types from these stock lengths,
 * or `null` when there are no pieces or one fits none of the lengths. */
function solve<T>(
  highs: Highs,
  types: PieceType<T>[],
  lengths: number[],
  settings: OptimiserSettings,
): CutPlan<T> | null {
  if (!types.length) return null;
  const caps = lengths.map((l) => l - 2 * settings.endTrimMm);
  if (types[0].size > Math.max(...caps)) return null;

  // 1. Without the solver (see the top of the file).
  const quick = packCheapestMix(types, lengths, caps);
  if (quick && quick !== 'none') return toPlan(quick, settings);

  // 2. Column generation: the floor, and a plan over its patterns.
  const { patterns, floor } = generatePatterns(highs, types, lengths, caps);
  const plan = solvePatterns(highs, patterns, types, lengths, caps);
  const metal = plan.reduce((sum, bar) => sum + bar.stockMm, 0);
  if (metal <= floor) return toPlan(plan, settings);

  // 3. Is there a cheaper plan between the floor and this one?
  const cheaper = packCheapestMix(
    types,
    lengths,
    caps,
    { min: floor, below: metal },
    SECOND_SEARCH_BUDGET,
  );
  if (cheaper === 'none') return toPlan(plan, settings); // proven
  if (cheaper) return toPlan(cheaper, settings);
  const flow = solveArcFlow(highs, types, lengths, caps);
  if (flow && flow.reduce((sum, bar) => sum + bar.stockMm, 0) < metal) {
    return toPlan(flow, settings);
  }
  return toPlan(plan, settings); // best found, not proven
}

/** Time limit of each HiGHS integer program, s. No measured profile
 * got a better plan from a longer one (bug-126). */
const SOLVER_SECONDS = 2;

/** The arc-flow model is built only up to this many arcs: the sample
 * frame has 2 k, the bead profile that crashed the browser far more. */
const MAX_ARCS = 60_000;

/** The search between the floor and the plan gets more steps (~150 ms):
 * the floor leaves it only a few mixes. */
const SECOND_SEARCH_BUDGET = 5_000_000;

interface Pattern {
  /** Index into the stock lengths. */
  stock: number;
  /** Pieces of each type. */
  counts: number[];
}

/** Column generation: start from one-type patterns plus best-fit's bars,
 * solve the linear program over them, and ask a knapsack per stock
 * length for the pattern the duals value most; repeat until none
 * improves it. `floor` is the least metal any mix of the lengths can
 * reach at or above the linear bound. */
function generatePatterns<T>(
  highs: Highs,
  types: PieceType<T>[],
  lengths: number[],
  caps: number[],
): { patterns: Pattern[]; floor: number } {
  const demand = types.map((type) => type.refs.length);
  const unit = lengths.reduce(gcd);
  const patterns: Pattern[] = [];
  const seen = new Set<string>();
  const add = (pattern: Pattern) => {
    const key = `${pattern.stock}:${pattern.counts.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    patterns.push(pattern);
    return true;
  };
  caps.forEach((cap, stock) =>
    types.forEach((type, t) => {
      const n = Math.min(Math.floor(cap / type.size), demand[t]);
      if (!n) return;
      const counts = types.map(() => 0);
      counts[t] = n;
      add({ stock, counts });
    }),
  );
  for (const counts of bestFitPatterns(types, caps[0]))
    add({ stock: 0, counts });

  for (;;) {
    const result = highs.solve(patternLp(patterns, demand, lengths, false), {
      output_flag: false,
    });
    if (result.Status !== 'Optimal') {
      throw new Error(`Bar optimiser: patterns ended with "${result.Status}"`);
    }
    const duals = (result.Rows as { Dual: number }[]).map((row) =>
      Math.max(0, row.Dual * unit),
    );
    let added = false;
    caps.forEach((cap, stock) => {
      const best = knapsack(cap, types, duals, demand);
      if (
        best.value > lengths[stock] + 1e-6 &&
        add({ stock, counts: best.counts })
      )
        added = true;
    });
    if (!added) {
      return {
        patterns,
        floor: floorMetal(result.ObjectiveValue * unit, lengths),
      };
    }
  }
}

/** Best-fit decreasing into bars of room `cap`, as pieces per type. */
function bestFitPatterns<T>(types: PieceType<T>[], cap: number): number[][] {
  const free: number[] = [];
  const counts: number[][] = [];
  types.forEach((type, t) => {
    for (let r = 0; r < type.refs.length; r++) {
      let pick = -1;
      for (let b = 0; b < free.length; b++) {
        if (free[b] >= type.size && (pick < 0 || free[b] < free[pick]))
          pick = b;
      }
      if (pick < 0) {
        free.push(cap);
        counts.push(types.map(() => 0));
        pick = free.length - 1;
      }
      free[pick] -= type.size;
      counts[pick][t]++;
    }
  });
  return counts;
}

/** Bounded knapsack by dynamic programming: the pattern of most dual
 * value that fits `cap`. Counts are split into powers of two. */
function knapsack<T>(
  cap: number,
  types: PieceType<T>[],
  duals: number[],
  limits: number[],
): { value: number; counts: number[] } {
  const items: { type: number; n: number; size: number; value: number }[] = [];
  types.forEach((type, t) => {
    if (duals[t] <= 0) return;
    let left = Math.min(limits[t], Math.floor(cap / type.size));
    for (let k = 1; left > 0; k *= 2) {
      const n = Math.min(k, left);
      items.push({ type: t, n, size: type.size * n, value: duals[t] * n });
      left -= n;
    }
  });
  const best = new Float64Array(cap + 1);
  const keep = items.map((item) => {
    const row = new Uint8Array(cap + 1);
    for (let c = cap; c >= item.size; c--) {
      const value = best[c - item.size] + item.value;
      if (value > best[c] + 1e-9) {
        best[c] = value;
        row[c] = 1;
      }
    }
    return row;
  });
  const counts = types.map(() => 0);
  let c = cap;
  for (let k = items.length - 1; k >= 0; k--) {
    if (!keep[k][c]) continue;
    counts[items[k].type] += items[k].n;
    c -= items[k].size;
  }
  return { value: best[cap], counts };
}

/** The pattern model in CPLEX LP format: cover every piece type, metal
 * minimised in units of the lengths' gcd (integral, so an absolute gap
 * under 1 proves the optimum of the integer program). */
function patternLp(
  patterns: Pattern[],
  demand: number[],
  lengths: number[],
  integer: boolean,
): string {
  const unit = lengths.reduce(gcd);
  const rows = demand.map((d, t) => {
    const terms = patterns.flatMap((p, j) =>
      p.counts[t] ? [`${p.counts[t]} p${j}`] : [],
    );
    return ` c${t}: ${terms.join(' + ')} >= ${d}`;
  });
  const objective = patterns
    .map((p, j) => `${lengths[p.stock] / unit} p${j}`)
    .join(' + ');
  return [
    'Minimize',
    ` metal: ${objective}`,
    'Subject To',
    ...rows,
    ...(integer
      ? ['General', ` ${patterns.map((_, j) => `p${j}`).join(' ')}`]
      : []),
    'End',
    '',
  ].join('\n');
}

/** The least metal some mix of the lengths reaches at or above `bound`. */
function floorMetal(bound: number, lengths: number[]): number {
  const unit = lengths.reduce(gcd);
  const steps = lengths.map((l) => l / unit);
  const target = Math.ceil(bound / unit - 1e-6);
  const reach = new Uint8Array(target + Math.max(...steps) + 1);
  reach[0] = 1;
  for (let t = 1; t < reach.length; t++) {
    reach[t] = steps.some((s) => t >= s && reach[t - s]) ? 1 : 0;
  }
  let t = Math.max(target, 0);
  while (!reach[t]) t++;
  return t * unit;
}

/** The integer program over the patterns (time-limited), as bars; best-
 * fit's bars when it found no plan in time. Pieces a pattern holds more
 * of than needed are left out. */
function solvePatterns<T>(
  highs: Highs,
  patterns: Pattern[],
  types: PieceType<T>[],
  lengths: number[],
  caps: number[],
): RawBar<T>[] {
  const demand = types.map((type) => type.refs.length);
  const result = highs.solve(patternLp(patterns, demand, lengths, true), {
    mip_abs_gap: 0.999,
    time_limit: SOLVER_SECONDS,
    output_flag: false,
  });
  const chosen = patterns.map((_, j) =>
    Math.round(
      (result.Columns as Record<string, { Primal?: number }>)[`p${j}`]
        ?.Primal ?? 0,
    ),
  );
  const toBars = (list: { stock: number; counts: number[] }[]) => {
    const refs = types.map((type) => [...type.refs]);
    const bars = list.flatMap(({ stock, counts }) => {
      const pieces = types.flatMap((type, t) =>
        refs[t]
          .splice(0, counts[t])
          .map((ref) => ({ lengthMm: type.lengthMm, ref })),
      );
      return pieces.length ? [{ stockMm: lengths[stock], pieces }] : [];
    });
    return refs.some((left) => left.length) ? null : bars;
  };
  return (
    toBars(
      patterns.flatMap((p, j) => Array.from({ length: chosen[j] }, () => p)),
    ) ??
    toBars(
      bestFitPatterns(types, caps[0]).map((counts) => ({ stock: 0, counts })),
    )!
  );
}

/** The arc-flow integer program (time-limited), or `null` when its graph
 * is too big to build safely or it found no plan in time. */
function solveArcFlow<T>(
  highs: Highs,
  types: PieceType<T>[],
  lengths: number[],
  caps: number[],
): RawBar<T>[] | null {
  const arcs = buildArcs(types, caps, MAX_ARCS);
  if (!arcs) return null;
  const result = highs.solve(toLpFormat(arcs, types, lengths), {
    mip_abs_gap: 0.999,
    time_limit: SOLVER_SECONDS,
    output_flag: false,
  });
  if (result.Status !== 'Optimal' && result.Status !== 'Time limit reached') {
    return null;
  }
  const flows = arcs.map((_, i) =>
    Math.round(
      (result.Columns as Record<string, { Primal?: number }>)[`x${i}`]
        ?.Primal ?? 0,
    ),
  );
  try {
    return decode(arcs, flows, types, lengths);
  } catch {
    return null; // no plan in time
  }
}

/** Steps the exact packing search may take per solve before it leaves
 * the profile to the solver (~30 ms). More doesn't pay: what it can't
 * settle in this many (many long pieces among short ones) it still
 * can't at 100×, and those are the profiles the solver does well. */
const SEARCH_BUDGET = 1_000_000;

type Item<T> = { size: number; lengthMm: number; ref: T };
type RawBar<T> = { stockMm: number; pieces: { lengthMm: number; ref: T }[] };

/** The pieces packed into the cheapest stock mix they really fit, or
 * `null` when that can't be settled here (the solver decides), or
 * `'none'` when no mix in `range` fits. Mixes
 * are tried cheapest first: best-fit decreasing on every mix of one
 * price (today's plans), then the exact search on each. A mix that
 * fits is the optimum only once every cheaper one is proven not to, so
 * a search out of budget hands the profile to the solver. A mix is
 * skipped when its total room is short, or when the pieces too long for
 * its smaller bars don't fit its longer ones alone. */
function packCheapestMix<T>(
  types: PieceType<T>[],
  lengths: number[],
  caps: number[],
  range: { min: number; below: number } = { min: 0, below: Infinity },
  steps: number = SEARCH_BUDGET,
): RawBar<T>[] | null | 'none' {
  // Longest first: the order best-fit and the search place pieces in.
  const items: Item<T>[] = types.flatMap((type) =>
    type.refs.map((ref) => ({ size: type.size, lengthMm: type.lengthMm, ref })),
  );
  const need = items.reduce((sum, it) => sum + it.size, 0);
  const maxBars = Math.ceil(need / Math.min(...caps)) + 1;
  // A plan exists in the longest bars alone: no mix dearer is needed.
  const ceiling = Math.min(
    barsOpenBestFit(items, caps[0]) * lengths[0],
    range.below - 1,
  );

  const mixes: { counts: number[]; metal: number }[] = [];
  const counts = lengths.map(() => 0);
  const walk = (i: number, metal: number, room: number) => {
    if (i === lengths.length) {
      if (
        metal >= range.min &&
        room >= need &&
        longPiecesFit(counts, caps, items)
      ) {
        mixes.push({ counts: [...counts], metal });
      }
      return;
    }
    for (let n = 0; n <= maxBars && metal + n * lengths[i] <= ceiling; n++) {
      counts[i] = n;
      walk(i + 1, metal + n * lengths[i], room + n * caps[i]);
    }
    counts[i] = 0;
  };
  walk(0, 0, 0);
  mixes.sort((a, b) => a.metal - b.metal);

  const budget = { left: steps };
  for (let from = 0; from < mixes.length;) {
    let to = from;
    while (to < mixes.length && mixes[to].metal === mixes[from].metal) to++;
    const level = mixes.slice(from, to).map((mix) =>
      mix.counts.flatMap((n, i) =>
        Array.from({ length: n }, () => ({
          stockMm: lengths[i],
          cap: caps[i],
        })),
      ),
    );
    for (const bins of level) {
      const bars = packBestFit(items, bins);
      if (bars) return bars;
    }
    let unsettled = false;
    for (const bins of level) {
      const bars = packExact(types, bins, budget);
      if (bars === 'budget') unsettled = true;
      else if (bars) return bars;
    }
    if (unsettled) return null;
    from = to;
  }
  return 'none';
}

/** Best-fit decreasing into these bars; `null` when a piece has no room. */
function packBestFit<T>(
  items: Item<T>[],
  bins: { stockMm: number; cap: number }[],
): RawBar<T>[] | null {
  const bars = bins.map((bin) => ({
    stockMm: bin.stockMm,
    free: bin.cap,
    pieces: [] as RawBar<T>['pieces'],
  }));
  for (const item of items) {
    let pick: (typeof bars)[number] | null = null;
    for (const bar of bars) {
      if (bar.free >= item.size && (!pick || bar.free < pick.free)) pick = bar;
    }
    if (!pick) return null;
    pick.free -= item.size;
    pick.pieces.push({ lengthMm: item.lengthMm, ref: item.ref });
  }
  return bars.filter((bar) => bar.pieces.length);
}

/** How many bars of room `cap` best-fit decreasing opens for the items. */
function barsOpenBestFit(items: { size: number }[], cap: number): number {
  const free: number[] = [];
  for (const item of items) {
    let pick = -1;
    for (let b = 0; b < free.length; b++) {
      if (free[b] >= item.size && (pick < 0 || free[b] < free[pick])) pick = b;
    }
    if (pick < 0) free.push(cap - item.size);
    else free[pick] -= item.size;
  }
  return free.length;
}

/** Every way of filling the bars, one bar at a time, until the pieces
 * fit: the bars, `null` when they can't, or `'budget'` when the search
 * ran out of steps first. Bar by bar rather than piece by piece, since
 * a tight mix leaves few ways to fill a bar: each fill may waste no more
 * than the slack still unspent, and must be full (no piece left over
 * fits its gap; one that did could always move in). Bars of one stock
 * length are interchangeable, so they are filled in order of their
 * longest piece, and an empty one only after the rest. Pieces of one
 * length are taken by count. */
function packExact<T>(
  types: PieceType<T>[],
  bins: { stockMm: number; cap: number }[],
  budget: { left: number },
): RawBar<T>[] | null | 'budget' {
  const left = types.map((type) => type.refs.length);
  let remaining = left.reduce((a, b) => a + b, 0);
  let slack =
    bins.reduce((sum, bin) => sum + bin.cap, 0) -
    types.reduce((sum, type) => sum + type.size * type.refs.length, 0);
  if (slack < 0) return null;
  // bins come longest stock first (packCheapestMix builds them so).
  const taken: number[][] = bins.map(() => types.map(() => 0));

  // `from`: the first type this bar may hold (its longest piece may be
  // no longer than the previous bar's of the same stock length).
  const fillBar = (b: number, from: number): boolean | 'budget' => {
    if (remaining === 0) return true;
    if (b === bins.length) return false;
    const sameStock = b > 0 && bins[b - 1].cap === bins[b].cap;
    const start = sameStock ? from : 0;
    let longest = -1;

    const take = (t: number, free: number): boolean | 'budget' => {
      if (--budget.left < 0) return 'budget';
      while (t < types.length && (!left[t] || types[t].size > free)) t++;
      if (t === types.length) {
        for (let q = start; q < types.length; q++) {
          if (left[q] && types[q].size <= free) return false; // not full
        }
        if (free > slack) return false;
        slack -= free;
        const found = fillBar(b + 1, longest < 0 ? types.length : longest);
        slack += free;
        return found;
      }
      const most = Math.min(left[t], Math.floor(free / types[t].size));
      for (let n = most; n >= 0; n--) {
        const opens = n > 0 && longest < 0;
        if (opens) longest = t;
        left[t] -= n;
        remaining -= n;
        taken[b][t] = n;
        const found = take(t + 1, free - n * types[t].size);
        taken[b][t] = 0;
        left[t] += n;
        remaining += n;
        if (opens) longest = -1;
        if (found) {
          if (found === true) taken[b][t] = n;
          return found;
        }
      }
      return false;
    };
    return take(start, bins[b].cap);
  };

  const found = fillBar(0, 0);
  if (found === 'budget') return 'budget';
  if (!found) return null;
  const refs = types.map((type) => [...type.refs]);
  return bins
    .map((bin, b) => ({
      stockMm: bin.stockMm,
      pieces: types.flatMap((type, t) =>
        refs[t]
          .splice(0, taken[b][t])
          .map((ref) => ({ lengthMm: type.lengthMm, ref })),
      ),
    }))
    .filter((bar) => bar.pieces.length);
}

/** Pieces longer than a bar's room can only go into longer bars, so
 * those alone must hold them. */
function longPiecesFit(
  counts: number[],
  caps: number[],
  items: { size: number }[],
): boolean {
  return caps.every((threshold) => {
    const need = items.reduce(
      (sum, it) => (it.size > threshold ? sum + it.size : sum),
      0,
    );
    const room = caps.reduce(
      (sum, cap, j) => (cap > threshold ? sum + counts[j] * cap : sum),
      0,
    );
    return need <= room;
  });
}

/** One graph per stock length; node `s:pos:lvl` is `pos` mm into the
 * usable bar with piece types `lvl…` still allowed (longest first).
 * `null` past `maxArcs`. */
function buildArcs<T>(
  types: PieceType<T>[],
  caps: number[],
  maxArcs: number,
): Arc[] | null {
  const arcs: Arc[] = [];
  for (const [stock, cap] of caps.entries()) {
    const seen = new Set<string>(['0:0']);
    const queue: [number, number][] = [[0, 0]];
    for (let head = 0; head < queue.length; head++) {
      if (arcs.length > maxArcs) return null;
      const [pos, lvl] = queue[head];
      const from = `${stock}:${pos}:${lvl}`;
      arcs.push({ stock, from, to: `${stock}:end`, type: -1 });
      for (let t = lvl; t < types.length; t++) {
        const next = pos + types[t].size;
        if (next > cap) continue;
        arcs.push({ stock, from, to: `${stock}:${next}:${t}`, type: t });
        const key = `${next}:${t}`;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push([next, t]);
        }
      }
    }
  }
  return arcs.length > maxArcs ? null : arcs;
}

/** The model in CPLEX LP format: flow in = flow out at every inner node,
 * bars of each length = flow leaving its start = flow reaching its end,
 * every piece type covered, metal minimised. */
function toLpFormat<T>(
  arcs: Arc[],
  types: PieceType<T>[],
  lengths: number[],
): string {
  const nodes = new Map<string, { in: string[]; out: string[] }>();
  const at = (n: string) => {
    let node = nodes.get(n);
    if (!node) nodes.set(n, (node = { in: [], out: [] }));
    return node;
  };
  arcs.forEach((arc, i) => {
    at(arc.from).out.push(`x${i}`);
    at(arc.to).in.push(`x${i}`);
  });

  const rows: string[] = [];
  for (const [name, node] of nodes) {
    const stock = name.slice(0, name.indexOf(':'));
    const rest = name.slice(name.indexOf(':') + 1);
    if (rest === '0:0') rows.push(`${node.out.join(' + ')} - z${stock} = 0`);
    else if (rest === 'end')
      rows.push(`${node.in.join(' + ')} - z${stock} = 0`);
    else rows.push(`${node.in.join(' + ')} - ${node.out.join(' - ')} = 0`);
  }
  types.forEach((type, t) => {
    const cover = arcs.flatMap((arc, i) => (arc.type === t ? [`x${i}`] : []));
    rows.push(`${cover.join(' + ')} >= ${type.refs.length}`);
  });

  const unit = lengths.reduce(gcd);
  const objective = lengths.map((l, s) => `${l / unit} z${s}`).join(' + ');
  const integers = [
    ...arcs.map((_, i) => `x${i}`),
    ...lengths.map((_, s) => `z${s}`),
  ];
  return [
    'Minimize',
    ` metal: ${objective}`,
    'Subject To',
    ...rows.map((row, i) => ` r${i}: ${row}`),
    'General',
    ` ${integers.join(' ')}`,
    'End',
    '',
  ].join('\n');
}

/** Flows back into bars: walk each unit of flow from a start node to its
 * end. The model may cover a type more than needed (≥); surplus pieces
 * are dropped, longest bars keep theirs first. */
function decode<T>(
  arcs: Arc[],
  flows: number[],
  types: PieceType<T>[],
  lengths: number[],
): { stockMm: number; pieces: { lengthMm: number; ref: T }[] }[] {
  const out = new Map<string, number[]>();
  arcs.forEach((arc, i) => {
    if (flows[i] <= 0) return;
    const list = out.get(arc.from) ?? [];
    list.push(i);
    out.set(arc.from, list);
  });
  const remaining = [...flows];
  const left = types.map((type) => [...type.refs]);
  const bars: { stockMm: number; pieces: { lengthMm: number; ref: T }[] }[] =
    [];

  lengths.forEach((stockMm, stock) => {
    for (;;) {
      let node = `${stock}:0:0`;
      const path: number[] = [];
      while (!node.endsWith(':end')) {
        const next = (out.get(node) ?? []).find((i) => remaining[i] > 0);
        if (next === undefined) break;
        remaining[next]--;
        path.push(arcs[next].type);
        node = arcs[next].to;
      }
      if (!path.length) break;
      const pieces = path.flatMap((t) => {
        if (t < 0) return [];
        const ref = left[t].shift();
        return ref === undefined ? [] : [{ lengthMm: types[t].lengthMm, ref }];
      });
      if (pieces.length) bars.push({ stockMm, pieces });
    }
  });
  if (left.some((refs) => refs.length)) {
    throw new Error('Bar optimiser: the solution left pieces uncut');
  }
  return bars;
}

/** Bars into a plan with its totals: pieces longest first, bars longest
 * stock first, then fullest first. */
export function toPlan<T>(
  raw: { stockMm: number; pieces: { lengthMm: number; ref: T }[] }[],
  settings: OptimiserSettings,
): CutPlan<T> {
  const bars: CutBar<T>[] = raw
    .map(({ stockMm, pieces }) => {
      const sorted = [...pieces].sort((a, b) => b.lengthMm - a.lengthMm);
      const piecesMm = sorted.reduce((sum, p) => sum + p.lengthMm, 0);
      return {
        stockMm,
        pieces: sorted,
        wasteMm: stockMm - piecesMm,
        offcutMm:
          stockMm -
          2 * settings.endTrimMm -
          (piecesMm + sorted.length * settings.kerfMm),
      };
    })
    .sort((a, b) => b.stockMm - a.stockMm || a.offcutMm - b.offcutMm);
  const mix: Record<number, number> = {};
  for (const bar of bars) mix[bar.stockMm] = (mix[bar.stockMm] ?? 0) + 1;
  const boughtMm = bars.reduce((sum, b) => sum + b.stockMm, 0);
  const piecesMm = bars.reduce(
    (sum, b) => sum + b.pieces.reduce((s, p) => s + p.lengthMm, 0),
    0,
  );
  return {
    mix,
    bars,
    barCount: bars.length,
    boughtMm,
    piecesMm,
    wasteMm: boughtMm - piecesMm,
    wastePct: boughtMm ? ((boughtMm - piecesMm) / boughtMm) * 100 : 0,
  };
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
