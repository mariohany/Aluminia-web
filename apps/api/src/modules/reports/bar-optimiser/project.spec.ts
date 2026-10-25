import type { CutMember } from '@repo/geometry/cut-list';
import {
  assembleProject,
  optimiseProject,
  type ProjectPiece,
} from '@repo/bar-optimiser/project';

const SETTINGS = { lengths: [6000, 6500], kerfMm: 4, endTrimMm: 10 };

const piece = (
  profile: string,
  member: CutMember,
  lengthMm: number,
  count: number,
): ProjectPiece<string> => ({
  profile,
  member,
  lengthMm,
  count,
  ref: `${profile}/${lengthMm}`,
});

describe('optimiseProject', () => {
  const pieces = [
    piece('BEAD-1', 'bead', 900, 4),
    piece('SASH-1', 'sash', 1100, 8),
    piece('FRAME-1', 'frame', 1500, 4),
    piece('FRAME-1', 'frame', 1200, 4),
    // One profile used as frame AND transom: counts under its majority.
    piece('MULTI', 'divider', 1000, 1),
    piece('MULTI', 'frame', 2000, 3),
  ];

  it('runs profiles in member order and reports progress around each', async () => {
    const events: string[] = [];
    const result = await optimiseProject(pieces, SETTINGS, {
      onProfileStart: (s) =>
        events.push(`start ${s.member} ${s.profile} ${s.index + 1}/${s.total}`),
      onProfileDone: (s) => events.push(`done ${s.profile}`),
    });
    expect(events).toEqual([
      'start frame FRAME-1 1/4',
      'done FRAME-1',
      'start frame MULTI 2/4',
      'done MULTI',
      'start sash SASH-1 3/4',
      'done SASH-1',
      'start bead BEAD-1 4/4',
      'done BEAD-1',
    ]);
    expect(result.profiles.map((p) => p.member)).toEqual([
      'frame',
      'frame',
      'sash',
      'bead',
    ]);
  });

  it('rolls profiles up into member groups and a project total', async () => {
    const { members, profiles, total } = await optimiseProject(
      pieces,
      SETTINGS,
    );
    expect(members.map((m) => m.member)).toEqual(['frame', 'sash', 'bead']);

    const frames = members[0];
    expect(frames.profiles).toEqual(['FRAME-1', 'MULTI']);
    expect(frames.pieceCount).toBe(12);
    const frameBest = profiles
      .filter((p) => p.member === 'frame')
      .reduce((sum, p) => sum + p.best!.boughtMm, 0);
    expect(frames.best.boughtMm).toBe(frameBest);
    for (const length of SETTINGS.lengths) {
      expect(frames.best.boughtMm).toBeLessThanOrEqual(
        frames.single[length]!.boughtMm,
      );
    }

    expect(total.pieceCount).toBe(24);
    expect(total.boughtMm).toBe(
      members.reduce((sum, m) => sum + m.best.boughtMm, 0),
    );
    expect(
      Object.entries(total.mix).reduce(
        (sum, [length, n]) => sum + Number(length) * n,
        0,
      ),
    ).toBe(total.boughtMm);
  });

  // docs/report_waste_kg_planing.md.
  it('waste weights: a profile keeps its %, a group weighs profiles by kg/m', async () => {
    const { profiles } = await optimiseProject(pieces, SETTINGS);
    const kgPerM: Record<string, number> = { 'FRAME-1': 1.9, MULTI: 0.3 };
    const weighed = assembleProject(profiles, SETTINGS, (p) => kgPerM[p] ?? 1);
    const frames = weighed.members.find((m) => m.member === 'frame')!;
    const [a, b] = ['FRAME-1', 'MULTI'].map(
      (name) => profiles.find((p) => p.profile === name)!.best!,
    );
    const kg = (mmA: number, mmB: number) => (mmA * 1.9 + mmB * 0.3) / 1000;
    expect(frames.best.wasteKg).toBeCloseTo(kg(a.wasteMm, b.wasteMm), 3);
    expect(frames.best.boughtKg).toBeCloseTo(kg(a.boughtMm, b.boughtMm), 3);
    expect(frames.best.wastePct).toBeCloseTo(
      (kg(a.wasteMm, b.wasteMm) / kg(a.boughtMm, b.boughtMm)) * 100,
      6,
    );
    // Without weights (the browser): the weights are metres.
    const plain = assembleProject(profiles, SETTINGS);
    const plainFrames = plain.members.find((m) => m.member === 'frame')!;
    expect(plainFrames.best.wasteKg).toBeCloseTo(
      plainFrames.best.wasteMm / 1000,
      3,
    );
    expect(plainFrames.best.wastePct).toBeCloseTo(
      (plainFrames.best.wasteMm / plainFrames.best.boughtMm) * 100,
      6,
    );
  });
});
