import {
  cheapestOf,
  optimiseProfile,
  solveMixed,
  solveSingleLength,
  type CutPlan,
  type OptimiserPiece,
  type OptimiserSettings,
} from '@repo/bar-optimiser/optimise';

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

/** Every piece placed exactly once, no bar over its capacity (the cut
 * after the last piece falls into the end trim), and the totals add up. */
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
    expect(used).toBeLessThanOrEqual(
      bar.stockMm - 2 * settings.endTrimMm + settings.kerfMm,
    );
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
    // 5980 between the trims + the last kerf = 2 × (2988 + 4 kerf).
    const settings = { ...SHOP, lengths: [6000] };
    const input = pieces({ 2988: 2 });
    const { best } = await optimiseProfile(input, settings);
    expect(best!.barCount).toBe(1);
    expect(best!.bars[0].offcutMm).toBe(0);
  });

  it('kerf and trim push a piece onto a second bar', async () => {
    // 2 × 2990 = 5980 of metal, but 2 × (2990 + 4) > 5980 + 4.
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

  // bug-110: 22 bead pieces in 16 different short lengths made the
  // arc-flow model 47 k nodes / 285 k arcs and HiGHS never finished. The
  // lower-bound proof settles it at once: they fit the cheapest mix that
  // could hold them at all.
  it('proves a many-short-lengths profile at the lower bound, instantly', async () => {
    const input = pieces({
      332: 1,
      334: 1,
      357: 1,
      359: 1,
      424: 1,
      427: 1,
      429: 2,
      430: 2,
      436: 2,
      439: 2,
      452: 1,
      456: 1,
      661: 1,
      664: 1,
      678: 2,
      703: 2,
    });
    const started = Date.now();
    const { best } = await optimiseProfile(input, SHOP);
    expectValid(best, input, SHOP);
    expect(best!.mix).toEqual({ 6000: 2 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  // bug-126: 42 bead pieces in 15 short lengths. The cheapest mix that
  // could hold them (2 × 6500 + 3 × 6000) has 364 mm to spare; best-fit
  // can't fill it, and HiGHS ran out of WebAssembly memory in the
  // browser. The exact search packs it.
  it('packs a tight mix best-fit misses, without the solver', async () => {
    const input = pieces({
      410: 2,
      414: 4,
      430: 4,
      455: 4,
      553: 2,
      555: 2,
      560: 2,
      561: 2,
      575: 2,
      577: 2,
      881: 2,
      894: 2,
      896: 4,
      1180: 4,
      1434: 4,
    });
    const started = Date.now();
    const { best } = await optimiseProfile(input, SHOP);
    expectValid(best, input, SHOP);
    expect(best!.mix).toEqual({ 6500: 2, 6000: 3 });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  // bug-126: profiles the search can't settle and whose arc-flow model
  // never finished (4 stock lengths). Column generation gives the floor
  // and a plan on it; both proven.
  const FOUR_STOCK: OptimiserSettings = {
    lengths: [7000, 6500, 6000, 5800],
    kerfMm: 3,
    endTrimMm: 5,
  };
  it.each([
    [
      'long and short pieces mixed',
      {
        311: 5,
        338: 1,
        382: 2,
        532: 5,
        591: 3,
        596: 5,
        873: 4,
        943: 1,
        1004: 1,
        1028: 4,
        1096: 3,
        1102: 3,
        1242: 3,
        1367: 4,
        1390: 2,
        1572: 1,
        2500: 5,
        3281: 5,
        3540: 1,
      },
      72_500,
    ],
    [
      '98 short pieces',
      {
        361: 1,
        408: 5,
        453: 5,
        708: 4,
        765: 5,
        798: 5,
        845: 5,
        879: 4,
        882: 5,
        900: 5,
        931: 1,
        946: 2,
        959: 5,
        994: 3,
        1004: 3,
        1047: 5,
        1120: 5,
        1185: 1,
        1205: 3,
        1370: 2,
        1484: 1,
        1547: 3,
        1550: 3,
        1570: 5,
        1597: 2,
      },
      86_200,
    ],
  ])(
    'four stock lengths, %s: the least metal, within the time limits',
    async (_name, spec, optimum) => {
      const input = pieces(spec);
      const { best } = await optimiseProfile(input, FOUR_STOCK);
      expectValid(best, input, FOUR_STOCK);
      expect(best!.boughtMm).toBe(optimum);
    },
    60_000,
  );

  // docs/mitre_cuts_planing.md M10.
  it('the cut after the last piece falls into the end trim', async () => {
    // 5980 between the trims: 2 × (2988 + 4) = 5984 fits only because the
    // second cut lands in the trim; the offcut is then 0, not -4.
    const settings = { ...SHOP, lengths: [6000] };
    const input = pieces({ 2988: 2 });
    const { best } = await optimiseProfile(input, settings);
    expectValid(best, input, settings);
    expect(best!.barCount).toBe(1);
    expect(best!.bars[0].offcutMm).toBe(0);
  });

  // docs/mitre_cuts_planing.md §6: real metal changes the totals, never
  // the bars.
  it('counts real metal in the totals and packs by cutting length', async () => {
    const plain = pieces({ 1500: 3, 900: 2 });
    const mitred = plain.map((p) => ({ ...p, metalMm: p.lengthMm - 45 }));
    const a = (await optimiseProfile(plain, SHOP)).best!;
    const b = (await optimiseProfile(mitred, SHOP)).best!;
    expect(b.bars.map((bar) => bar.pieces.map((p) => p.lengthMm))).toEqual(
      a.bars.map((bar) => bar.pieces.map((p) => p.lengthMm)),
    );
    expect(b.boughtMm).toBe(a.boughtMm);
    expect(b.piecesMm).toBe(a.piecesMm - 5 * 45);
    expect(b.wasteMm).toBe(a.wasteMm + 5 * 45);
    expect(b.bars.reduce((n, bar) => n + bar.wasteMm, 0)).toBe(b.wasteMm);
    expect(b.bars.map((bar) => bar.offcutMm)).toEqual(
      a.bars.map((bar) => bar.offcutMm),
    );
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

  // Optimal metal, proven (mixed 6000 + 6500, kerf 4, trim 10; the sash
  // at the lower bound).
  const OPTIMUM: Record<string, number> = {
    'S67-1101 frame': 7 * 6000 + 4 * 6500,
    'S67-2201 sash': 1 * 6000 + 10 * 6500, // 11 × 6500 before M10
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

  // 150 copies of each window of a test-deploy project (bug-128): ~700
  // bars a profile ran Node out of 4 GB and overflowed a browser
  // worker's stack in the mix search. Every plan here is at its floor.
  const BIG_SHOP: OptimiserSettings = {
    lengths: [7000, 6500, 6000, 5000],
    kerfMm: 4,
    endTrimMm: 10,
  };
  const BIG: Record<string, [Record<number, number>, number]> = {
    frame: [{ 500: 300, 1000: 300, 2000: 600, 2500: 300, 3927: 300 }, 3715500],
    bead: [
      {
        410: 300,
        414: 1200,
        430: 1200,
        455: 1200,
        553: 600,
        555: 600,
        560: 600,
        561: 600,
        575: 600,
        577: 600,
        881: 600,
        894: 300,
        896: 1200,
        1180: 1200,
        1434: 1200,
      },
      8787500,
    ],
    divider: [
      { 430: 300, 561: 600, 960: 600, 1180: 300, 1450: 600, 2410: 600 },
      3740000,
    ],
    sash: [{ 1450: 1200 }, 1800000],
  };

  it.each(Object.entries(BIG))(
    '150 copies of a window, %s: the proven least metal, in seconds',
    async (_, [spec, optimum]) => {
      const input = pieces(spec);
      const { best } = await optimiseProfile(input, BIG_SHOP);
      expectValid(best, input, BIG_SHOP);
      expect(best!.boughtMm).toBe(optimum);
    },
    30_000,
  );

  // The browser solves the parts on separate workers, in whatever order
  // they finish (docs/report_speed_planing.md §4): same plans.
  it('the parts give the same plans as one optimiseProfile, in any order', async () => {
    let seed = 11;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const settings = {
      lengths: [7000, 6500, 6000, 5000],
      kerfMm: 4,
      endTrimMm: 10,
    };
    for (let run = 0; run < 12; run++) {
      const spec: Record<number, number> = {};
      const kinds = 2 + Math.floor(rand() * 6);
      for (let k = 0; k < kinds; k++) {
        spec[300 + Math.floor(rand() * 3000)] = 1 + Math.floor(rand() * 20);
      }
      const input = pieces(spec);
      const whole = await optimiseProfile(input, settings);
      const single: Record<number, CutPlan<string> | null> = {};
      for (const length of [5000, 7000, 6000, 6500]) {
        single[length] = await solveSingleLength(input, settings, length);
      }
      expect(single).toEqual(whole.single);
      expect(await solveMixed(input, settings, cheapestOf(single))).toEqual(
        whole.best,
      );
    }
  }, 60_000);

  it('one usable length: the mixed plan is that plan', async () => {
    const settings = { ...SHOP, lengths: [6000] };
    const input = pieces({ 2400: 3 });
    const plan = await solveSingleLength(input, settings, 6000);
    expect(await solveMixed(input, settings, plan)).toBe(plan);
  });
});
