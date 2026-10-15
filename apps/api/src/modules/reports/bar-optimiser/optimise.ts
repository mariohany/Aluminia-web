import highsLoader, { type Highs } from 'highs';

// The bar optimiser (docs/reports_planing.md §4): cut one profile's
// pieces out of stock bars, buying the least metal. No Nest; the report
// job calls it per profile.
//
// A bar of length L has L − 2·trim usable; every piece uses its length
// plus one kerf. Waste is everything bought that isn't a piece (D3):
// kerf, trim and every offcut. Minimising waste is minimising metal
// bought (the pieces are fixed). Lengths may be mixed within a profile
// (D2), and the answer is the PROVEN least waste with no time cap (D21).
//
// Method: the arc-flow integer program for cutting stock (Valério de
// Carvalho), solved by HiGHS. Each stock length gets a graph whose nodes
// are (position along the usable bar, shortest piece type allowed next);
// an arc adds one piece, pieces always longest first, so every cutting
// pattern is exactly one path from the start to the end. One unit of flow
// is one bar; the solver picks flows that cover every piece and minimise
// metal. Its linear relaxation is famously tight, which is what lets it
// prove the optimum quickly where a plain search can't (a hand-written
// branch-and-bound ran out of memory on a 48-piece frame profile).
// Sample project, largest profile (76 sash pieces, 2 lengths mixed): ~5 s.

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
/** HiGHS is a ~4 MB WebAssembly module: loaded once, on first use. */
function getSolver(): Promise<Highs> {
  solver ??= highsLoader();
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
  const lengths = [...new Set(settings.lengths)]
    .filter((l) => l > 2 * settings.endTrimMm)
    .sort((a, b) => b - a);
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

  // Proof without the solver, when the easy answer is already the best
  // possible: no packing can use less metal than the cheapest stock mix
  // with room for every piece (+ kerf). If best-fit fills such a mix,
  // that is the proven optimum. Profiles of many short, different
  // lengths make the arc-flow model explode (47 k nodes for 16 bead
  // lengths, which HiGHS never finished — bug-110) yet are exactly the
  // ones this settles at once.
  const proven = packAtLowerBound(types, lengths, caps);
  if (proven) return toPlan(proven, settings);

  const arcs = buildArcs(types, caps);
  const lp = toLpFormat(arcs, types, lengths);
  // The objective counts metal in units of the lengths' gcd, so it is
  // integral and an absolute gap under 1 proves the optimum.
  const result = highs.solve(lp, { mip_abs_gap: 0.999, output_flag: false });
  if (result.Status !== 'Optimal') {
    throw new Error(`Bar optimiser: solver ended with "${result.Status}"`);
  }
  const flows = arcs.map((_, i) =>
    Math.round(result.Columns[`x${i}`]?.Primal ?? 0),
  );
  const bars = decode(arcs, flows, types, lengths);
  return toPlan(bars, settings);
}

/** Best-fit decreasing into each cheapest stock mix that could hold the
 * pieces at all; the bars if one fits, else `null` (the solver decides).
 * A mix is skipped when its total room is short, or when the pieces too
 * long for its smaller bars don't fit its longer ones alone. */
function packAtLowerBound<T>(
  types: PieceType<T>[],
  lengths: number[],
  caps: number[],
): { stockMm: number; pieces: { lengthMm: number; ref: T }[] }[] | null {
  const items = types.flatMap((type) =>
    type.refs.map((ref) => ({ size: type.size, lengthMm: type.lengthMm, ref })),
  );
  const need = items.reduce((sum, it) => sum + it.size, 0);
  const maxBars = Math.ceil(need / Math.min(...caps)) + 1;

  // Branch and bound on metal: only mixes no dearer than the cheapest
  // found so far are explored, so many stock lengths stay cheap.
  let cheapest = Infinity;
  let mixes: { counts: number[]; metal: number }[] = [];
  const counts = lengths.map(() => 0);
  const walk = (i: number, metal: number, room: number) => {
    if (metal > cheapest) return;
    if (i === lengths.length) {
      if (room >= need && longPiecesFit(counts, caps, items)) {
        if (metal < cheapest) {
          cheapest = metal;
          mixes = [];
        }
        mixes.push({ counts: [...counts], metal });
      }
      return;
    }
    for (let n = 0; n <= maxBars && metal + n * lengths[i] <= cheapest; n++) {
      counts[i] = n;
      walk(i + 1, metal + n * lengths[i], room + n * caps[i]);
    }
    counts[i] = 0;
  };
  walk(0, 0, 0);
  if (!mixes.length) return null;

  for (const mix of mixes) {
    const bars = mix.counts.flatMap((n, i) =>
      Array.from({ length: n }, () => ({
        stockMm: lengths[i],
        free: caps[i],
        pieces: [] as { lengthMm: number; ref: T }[],
      })),
    );
    let fits = true;
    for (const item of items) {
      let pick: (typeof bars)[number] | null = null;
      for (const bar of bars) {
        if (bar.free >= item.size && (!pick || bar.free < pick.free))
          pick = bar;
      }
      if (!pick) {
        fits = false;
        break;
      }
      pick.free -= item.size;
      pick.pieces.push({ lengthMm: item.lengthMm, ref: item.ref });
    }
    if (fits) return bars.filter((bar) => bar.pieces.length);
  }
  return null;
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
 * usable bar with piece types `lvl…` still allowed (longest first). */
function buildArcs<T>(types: PieceType<T>[], caps: number[]): Arc[] {
  const arcs: Arc[] = [];
  caps.forEach((cap, stock) => {
    const seen = new Set<string>(['0:0']);
    const queue: [number, number][] = [[0, 0]];
    for (let head = 0; head < queue.length; head++) {
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
  });
  return arcs;
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

function toPlan<T>(
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
