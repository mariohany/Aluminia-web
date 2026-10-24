import {
  optimiseProject,
  type ProjectPiece,
} from '@repo/bar-optimiser/project';
import {
  SolveRefused,
  solveInput,
  solvedProfileOf,
  validateSolve,
  type SolveResult,
} from '@repo/bar-optimiser/solve-result';

// The API's check of a browser's plans (docs/browser_solve_planing.md §5).

const settings = { lengths: [6000, 6500], kerfMm: 4, endTrimMm: 10 };

type Ref = { label: string };
const line = (
  profile: string,
  lengthMm: number,
  count: number,
  label: string,
): ProjectPiece<Ref> => ({
  profile,
  member: profile === 'sash' ? 'sash' : 'frame',
  lengthMm,
  count,
  ref: { label },
});

const lines: ProjectPiece<Ref>[] = [
  line('frame', 1200, 7, 'W1 top'),
  line('frame', 1750, 5, 'W1 side'),
  line('sash', 990, 9, 'W1 sash'),
  line('sash', 6200, 2, 'W2 tall sash'), // fits only the 6500
  line('frame', 7000, 1, 'W3 too long'), // fits no bar
];

/** What an honest browser sends: the real optimiser on line numbers. */
async function browserSolve(): Promise<SolveResult> {
  const project = await optimiseProject(solveInput(lines), settings);
  return {
    profiles: project.profiles.map((p) => solvedProfileOf(p.profile, p)),
  };
}

const copy = (result: SolveResult): SolveResult =>
  JSON.parse(JSON.stringify(result)) as SolveResult;

const refused = (result: SolveResult, message: RegExp) => {
  expect(() => validateSolve(lines, settings, result)).toThrow(SolveRefused);
  expect(() => validateSolve(lines, settings, result)).toThrow(message);
};

describe('validateSolve', () => {
  let honest: SolveResult;
  beforeAll(async () => {
    honest = await browserSolve();
  });

  it('accepts the real optimiser and rebuilds the same totals itself', async () => {
    const server = await optimiseProject(lines, settings);
    const checked = validateSolve(lines, settings, copy(honest));
    expect(checked.total).toEqual(server.total);
    expect(checked.members).toEqual(server.members);
    const frame = checked.profiles.find((p) => p.profile === 'frame');
    expect(frame?.tooLong.map((p) => p.ref.label)).toEqual(['W3 too long']);
    expect(frame?.best?.bars[0].pieces[0].ref).toHaveProperty('label');
  });

  it('refuses a missing, unknown or doubled profile', () => {
    const missing = copy(honest);
    missing.profiles.pop();
    refused(missing, /is missing/);

    const unknown = copy(honest);
    unknown.profiles.push({ ...unknown.profiles[0], profile: 'other' });
    refused(unknown, /isn't in this project/);

    const twice = copy(honest);
    twice.profiles.push(twice.profiles[0]);
    refused(twice, /sent twice/);
  });

  it('refuses a plan that drops or doubles a piece', () => {
    const dropped = copy(honest);
    const bars = dropped.profiles[0].best!;
    bars[0].pieces.pop();
    if (!bars[0].pieces.length) bars.shift();
    refused(dropped, /is cut \d+×, needs \d+×/);

    const doubled = copy(honest);
    const bar = doubled.profiles[0].best![0];
    doubled.profiles[0].best!.push({
      stockMm: bar.stockMm,
      pieces: [bar.pieces[0]],
    });
    refused(doubled, /is cut \d+×, needs \d+×/);
  });

  it('refuses a piece from another profile, out of range, or too long to cut', () => {
    const frameAt = honest.profiles.findIndex((p) => p.profile === 'frame');
    for (const bad of [2 /* a sash line */, 99, -1, 4 /* too long */]) {
      const result = copy(honest);
      result.profiles[frameAt].best![0].pieces.push(bad);
      refused(result, /isn't cut from this profile/);
    }
  });

  it('refuses an unknown stock length, or another length in a single plan', () => {
    const odd = copy(honest);
    odd.profiles[0].best![0].stockMm = 5000;
    refused(odd, /5000 mm isn't an allowed stock length/);

    const mixed = copy(honest);
    const frame = mixed.profiles.find((p) => p.profile === 'frame')!;
    frame.single['6000']![0].stockMm = 6500;
    refused(mixed, /6500 mm isn't an allowed stock length/);
  });

  it('refuses an overfilled or empty bar', () => {
    const frameAt = honest.profiles.findIndex((p) => p.profile === 'frame');
    const overfilled = copy(honest);
    const all = overfilled.profiles[frameAt].best!.flatMap((b) => b.pieces);
    overfilled.profiles[frameAt].best = [{ stockMm: 6500, pieces: all }];
    refused(overfilled, /bar is overfilled/);

    const empty = copy(honest);
    empty.profiles[frameAt].best!.push({ stockMm: 6000, pieces: [] });
    refused(empty, /has no pieces/);
  });

  it('checks single-length plans against which lengths every piece fits', () => {
    const sash = (r: SolveResult) =>
      r.profiles.find((p) => p.profile === 'sash')!;
    expect(sash(honest).single['6000']).toBeNull(); // 6200 mm piece
    expect(sash(honest).single['6500']).not.toBeNull();

    const madeUp = copy(honest);
    sash(madeUp).single['6000'] = sash(madeUp).single['6500']!.map((b) => ({
      ...b,
      stockMm: 6000,
    }));
    refused(madeUp, /6000 mm can't hold every piece, yet has a plan/);

    const dropped = copy(honest);
    sash(dropped).single['6500'] = null;
    refused(dropped, /the 6500 mm plan is missing/);

    const keys = copy(honest);
    delete sash(keys).single['6000'];
    refused(keys, /don't match the stock lengths/);
  });

  it('refuses a best plan that buys more metal than a single-length one', () => {
    const result = copy(honest);
    const frame = result.profiles.find((p) => p.profile === 'frame')!;
    // One piece per 6500 bar: valid, but far worse than the 6000 plan.
    frame.best = frame.best!.flatMap((b) =>
      Array.from({ length: b.count ?? 1 }, () => b.pieces).flatMap((pieces) =>
        pieces.map((piece) => ({ stockMm: 6500, pieces: [piece] })),
      ),
    );
    refused(result, /buys more metal than the \d+ mm one/);
  });

  it('refuses a plan for a profile with nothing to cut', () => {
    const onlyTooLong = [line('frame', 7000, 1, 'too long')];
    const result: SolveResult = {
      profiles: [
        {
          profile: 'frame',
          best: [{ stockMm: 6500, pieces: [0] }],
          single: { '6500': null, '6000': null },
        },
      ],
    };
    expect(() => validateSolve(onlyTooLong, settings, result)).toThrow(
      /has no plan to cut/,
    );
    result.profiles[0].best = null;
    const checked = validateSolve(onlyTooLong, settings, result);
    expect(checked.profiles[0].tooLong).toHaveLength(1);
    expect(checked.total.barCount).toBe(0);
  });

  // docs/report_speed_planing.md §5: identical bars are sent once.
  it('sends identical bars once with a count, and checks them as many', () => {
    const counted = honest.profiles.flatMap((p) => [
      ...(p.best ?? []),
      ...Object.values(p.single).flatMap((plan) => plan ?? []),
    ]);
    expect(counted.some((bar) => (bar.count ?? 1) > 1)).toBe(true);

    // An older browser sends every bar: the same report.
    const expanded = copy(honest);
    for (const p of expanded.profiles) {
      const spread = (plan: SolveResult['profiles'][number]['best']) =>
        plan?.flatMap(({ count = 1, ...bar }) =>
          Array.from({ length: count }, () => ({ ...bar })),
        ) ?? null;
      p.best = spread(p.best);
      for (const length of Object.keys(p.single)) {
        p.single[length] = spread(p.single[length]);
      }
    }
    expect(validateSolve(lines, settings, expanded).total).toEqual(
      validateSolve(lines, settings, copy(honest)).total,
    );
  });

  it('refuses a forged count before multiplying any bars out', () => {
    const forged = copy(honest);
    forged.profiles[0].best![0].count = 100_000;
    refused(forged, /is cut \d+×, needs \d+×/);

    const zero = copy(honest);
    zero.profiles[0].best![0].count = 0;
    refused(zero, /a bar is cut 0×/);
  });
});
