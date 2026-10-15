import {
  optimiseProfile,
  type CutPlan,
  type OptimiserPiece,
  type OptimiserSettings,
} from './optimise';

const NO_LOSS: OptimiserSettings = {
  lengths: [6000],
  kerfMm: 0,
  endTrimMm: 0,
};
const SHOP: OptimiserSettings = {
  lengths: [6000, 6500],
  kerfMm: 4,
  endTrimMm: 10,
};

const pieces = (spec: Record<number, number>): OptimiserPiece<string>[] =>
  Object.entries(spec).map(([length, count]) => ({
    lengthMm: Number(length),
    count,
    ref: `p${length}`,
  }));

/** Every piece placed exactly once, no bar over its usable length, and
 * the totals add up. */
function expectValid(
  plan: CutPlan<string> | null,
  input: OptimiserPiece<string>[],
  settings: OptimiserSettings,
) {
  expect(plan).not.toBeNull();
  const p = plan!;
  const placed = p.bars.flatMap((b) => b.pieces.map((x) => x.lengthMm));
  const wanted = input.flatMap((x) =>
    Array.from({ length: x.count }, () => x.lengthMm),
  );
  expect([...placed].sort((a, b) => a - b)).toEqual(
    [...wanted].sort((a, b) => a - b),
  );
  for (const bar of p.bars) {
    const used = bar.pieces.reduce(
      (sum, x) => sum + x.lengthMm + settings.kerfMm,
      0,
    );
    expect(used).toBeLessThanOrEqual(bar.stockMm - 2 * settings.endTrimMm);
    expect(bar.offcutMm).toBeGreaterThanOrEqual(0);
    expect(bar.pieces.map((x) => x.lengthMm)).toEqual(
      [...bar.pieces.map((x) => x.lengthMm)].sort((a, b) => b - a),
    );
  }
  const bought = p.bars.reduce((sum, b) => sum + b.stockMm, 0);
  expect(p.boughtMm).toBe(bought);
  expect(p.piecesMm).toBe(wanted.reduce((a, b) => a + b, 0));
  expect(p.wasteMm).toBe(bought - p.piecesMm);
  expect(p.barCount).toBe(p.bars.length);
}

describe('optimiseProfile', () => {
  it('one piece, one bar; waste is everything else of the bar', async () => {
    const input = pieces({ 2400: 1 });
    const { best } = await optimiseProfile(input, SHOP);
    expectValid(best, input, SHOP);
    expect(best!.mix).toEqual({ 6000: 1 });
    expect(best!.wasteMm).toBe(3600);
    expect(best!.bars[0].offcutMm).toBe(6000 - 20 - 2404);
  });

  it('an exact fit uses one bar with nothing left', async () => {
    // 5980 usable = 2 × (2986 + 4 kerf).
    const settings = { ...SHOP, lengths: [6000] };
    const input = pieces({ 2986: 2 });
    const { best } = await optimiseProfile(input, settings);
    expect(best!.barCount).toBe(1);
    expect(best!.bars[0].offcutMm).toBe(0);
  });

  it('kerf and trim push a piece onto a second bar', async () => {
    // 2 × 2990 = 5980 of metal, but 2 × (2990 + 4) > 5980 usable.
    const settings = { ...SHOP, lengths: [6000] };
    const { best } = await optimiseProfile(pieces({ 2990: 2 }), settings);
    expect(best!.barCount).toBe(2);
  });

  it('mixing lengths beats either length alone', async () => {
    const settings = { lengths: [6000, 6500], kerfMm: 0, endTrimMm: 0 };
    const input = pieces({ 3250: 2, 3000: 2 });
    const { best, single } = await optimiseProfile(input, settings);
    expectValid(best, input, settings);
    expect(single[6000]!.boughtMm).toBe(18000); // 3000+3000 | 3250 | 3250
    expect(single[6500]!.boughtMm).toBe(13000);
    expect(best!.mix).toEqual({ 6500: 1, 6000: 1 });
    expect(best!.boughtMm).toBe(12500);
  });

  it('finds the packing best-fit misses', async () => {
    // 6,6,5,4,3,2,2,2 into three bars of 10 — (6,4) (6,2,2) (5,3,2) —
    // which best-fit decreasing can't do.
    const input = pieces({ 3600: 2, 3000: 1, 2400: 1, 1800: 1, 1200: 3 });
    const { best } = await optimiseProfile(input, NO_LOSS);
    expectValid(best, input, NO_LOSS);
    expect(best!.barCount).toBe(3);
    expect(best!.wasteMm).toBe(0);
  });

  it('lists a piece too long for any bar instead of failing', async () => {
    const input = pieces({ 6600: 1, 2000: 2 });
    const { best, tooLong } = await optimiseProfile(input, SHOP);
    expect(tooLong.map((p) => p.lengthMm)).toEqual([6600]);
    expect(best!.piecesMm).toBe(4000);
  });

  it('a single length that no piece fits in is null', async () => {
    const { single, best } = await optimiseProfile(pieces({ 6200: 1 }), SHOP);
    expect(single[6000]).toBeNull();
    expect(best!.mix).toEqual({ 6500: 1 });
  });

  it('the mixed plan is never worse than any single length', async () => {
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let run = 0; run < 25; run++) {
      const spec: Record<number, number> = {};
      const kinds = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < kinds; k++) {
        spec[400 + Math.floor(rand() * 2600)] = 1 + Math.floor(rand() * 4);
      }
      const input = pieces(spec);
      const { best, single } = await optimiseProfile(input, SHOP);
      expectValid(best, input, SHOP);
      for (const plan of Object.values(single)) {
        expectValid(plan, input, SHOP);
        expect(best!.boughtMm).toBeLessThanOrEqual(plan!.boughtMm);
      }
    }
  });

  // The sample project on the design canvas (docs/design_canvas/rep_data.py).
  const SAMPLE: Record<string, Record<number, number>> = {
    'S67-1101 frame': {
      2400: 8,
      2100: 2,
      1500: 12,
      1400: 4,
      1200: 8,
      900: 2,
      700: 6,
      600: 6,
    },
    'S67-2201 sash': {
      1426: 8,
      1146: 16,
      1126: 8,
      953: 16,
      646: 8,
      626: 6,
      546: 8,
      526: 6,
    },
    'SL90-2140 sliding leaf': { 1400: 12, 1300: 8, 870: 12, 770: 8 },
    'S67-3101 transom': { 2310: 4, 1410: 2, 1110: 2, 937: 4 },
  };

  // Optimal metal, proven by HiGHS (mixed 6000 + 6500, kerf 4, trim 10).
  const OPTIMUM: Record<string, number> = {
    'S67-1101 frame': 7 * 6000 + 4 * 6500,
    'S67-2201 sash': 11 * 6500,
    'SL90-2140 sliding leaf': 2 * 6000 + 5 * 6500,
    'S67-3101 transom': 1 * 6000 + 2 * 6500,
  };

  it.each(Object.entries(SAMPLE))(
    'sample project %s: the proven least metal',
    async (name, spec) => {
      const input = pieces(spec);
      const { best, single } = await optimiseProfile(input, SHOP);
      expectValid(best, input, SHOP);
      expect(best!.boughtMm).toBe(OPTIMUM[name]);
      for (const plan of Object.values(single)) {
        expect(best!.boughtMm).toBeLessThanOrEqual(plan!.boughtMm);
      }
    },
    60_000,
  );
});
