import type { Project } from '../../database/tenant/entities/project.entity';
import type { CutBar } from '@repo/bar-optimiser/optimise';
import { optimiseProject, profileQueue } from '@repo/bar-optimiser/project';
import type { WindowDetail } from '@repo/types/windows';
import {
  barGroupOf,
  buildProjectPieces,
  colorsOf,
  recolored,
  reportSnapshotOf,
  planKeysOf,
  profileNoOf,
  profileRefOf,
  patternsOf,
  snapshotFingerprintOf,
  solveFingerprintOf,
  type PieceRef,
  type ReportInputs,
} from './report-inputs';

// Two fingerprints (docs/browser_pdf_planing.md §4): what changes the
// cutting plan means solve again; a project or client rename only means
// refresh the snapshot's names; the company is never in either.

const at = (iso: string) => new Date(iso);

function inputs(): ReportInputs {
  return {
    project: {
      updatedAt: at('2026-10-01T10:00:00Z'),
      client: { updatedAt: at('2026-10-01T09:00:00Z') },
    } as Project,
    windows: [
      { id: 'w1', updatedAt: '2026-10-02T10:00:00.000Z', panels: [] },
    ] as unknown as ReportInputs['windows'],
    settings: {
      kerfMm: 4,
      endTrimMm: 10,
      extraLengthsMm: [],
      stockLengthsMm: [6500, 6000],
      updatedAt: null,
    },
    profiles: new Map(),
    colors: new Map(),
    letterhead: {
      enName: null,
      arName: null,
      logoFileId: null,
      updatedAt: null,
    },
  };
}

describe('report fingerprints', () => {
  const base = inputs();
  const solve = solveFingerprintOf(base);

  it('a window or settings change means solve again', () => {
    const edited = inputs();
    edited.windows[0].updatedAt = '2026-10-03T10:00:00.000Z';
    expect(solveFingerprintOf(edited)).not.toBe(solve);

    const saw = inputs();
    saw.settings.updatedAt = at('2026-10-03T10:00:00Z');
    expect(solveFingerprintOf(saw)).not.toBe(solve);
  });

  it('a project or client rename only refreshes the snapshot; the letterhead never does (P6–P8)', () => {
    const snapshot = snapshotFingerprintOf(base);
    const renamed = inputs();
    renamed.project.updatedAt = at('2026-10-03T10:00:00Z');
    const client = inputs();
    client.project.client.updatedAt = at('2026-10-03T10:00:00Z');
    for (const changed of [renamed, client]) {
      expect(solveFingerprintOf(changed)).toBe(solve);
      expect(snapshotFingerprintOf(changed)).not.toBe(snapshot);
    }
    const logo = inputs();
    logo.letterhead.updatedAt = at('2026-10-03T10:00:00Z');
    expect(snapshotFingerprintOf(logo)).toBe(snapshot);

    const edited = inputs();
    edited.windows[0].updatedAt = '2026-10-03T10:00:00.000Z';
    expect(snapshotFingerprintOf(edited)).not.toBe(snapshot);
  });
});

// docs/report_speed_planing.md §5: the snapshot keeps each cut once.
describe('patternsOf', () => {
  const piece = (lengthMm: number, windowName: string, end = 45) => ({
    lengthMm,
    ref: {
      windowId: windowName,
      windowName,
      member: 'frame' as const,
      at: {
        panelIndex: 0,
        sectionIndex: null,
        sashIndex: null,
        position: 'top' as const,
      },
      endsMm: [end, end] as [number, number],
    },
  });
  const bar = (
    stockMm: number,
    pieces: ReturnType<typeof piece>[],
  ): CutBar<PieceRef> => ({ stockMm, pieces, wasteMm: 100, offcutMm: 80 });

  it('groups by stock, lengths and ends; counts where the pieces go', () => {
    const bars = [
      bar(7000, [piece(2500, 'W1'), piece(2500, 'W1')]),
      bar(7000, [piece(2500, 'W2'), piece(2500, 'W1')]),
      bar(7000, [piece(2500, 'W1', 0), piece(2500, 'W1')]), // square end
      bar(6500, [piece(2500, 'W1'), piece(2500, 'W1')]),
    ];
    const patterns = patternsOf(bars);
    expect(patterns.map((p) => [p.bar.stockMm, p.count])).toEqual([
      [7000, 2],
      [7000, 1],
      [6500, 1],
    ]);
    expect(patterns[0].goesTo.map((g) => [g.windowName, g.count])).toEqual([
      ['W1', 3],
      ['W2', 1],
    ]);
    expect(patterns.reduce((n, p) => n + p.count, 0)).toBe(bars.length);
  });
});

// Bar groups (docs/report_colours_planing.md §3): only one profile in one
// interior + exterior colour pair may share a bar.
describe('bar groups', () => {
  const FRAME = 'platform:00000000-0000-4000-8000-000000000001';
  const WHITE = 'platform:00000000-0000-4000-8000-0000000000a1';
  const GREY = 'company:00000000-0000-4000-8000-0000000000a2';
  const settings = { lengths: [6500, 6000], kerfMm: 4, endTrimMm: 10 };

  const window = (
    id: string,
    widthMm: number,
    interiorColor: string | null,
    exteriorColor: string | null,
  ) =>
    ({
      id,
      name: id,
      quantity: 3,
      updatedAt: '2026-10-02T10:00:00.000Z',
      panels: [
        {
          xMm: 0,
          yMm: 0,
          widthMm,
          heightMm: 1500,
          frameProfile: FRAME,
          dividerProfile: null,
          dividers: [],
          sections: [
            {
              faceKey: 'left|right|sill|top',
              openingType: null,
              glassKind: 'single',
              glass: null,
              hasFlyScreen: false,
              sliding: null,
            },
          ],
          isDoor: false,
          interiorColor,
          exteriorColor,
          headShape: 'flat',
          headRiseMm: null,
        },
      ],
    }) as unknown as WindowDetail;

  const piecesOf = (...windows: WindowDetail[]) => {
    const base = inputs();
    base.windows = windows;
    return { base, pieces: buildProjectPieces(base) };
  };

  it('a different colour pair is its own group; empty is its own too', () => {
    const { pieces } = piecesOf(
      window('w1', 1200, WHITE, GREY),
      window('w2', 1100, WHITE, WHITE),
      window('w3', 1000, null, null),
    );
    expect(pieces.pieces.length).toBeGreaterThan(0);
    expect(
      profileQueue(pieces.pieces)
        .map((q) => q.profile)
        .sort(),
    ).toEqual(
      [
        barGroupOf(FRAME, WHITE, GREY),
        barGroupOf(FRAME, WHITE, WHITE),
        barGroupOf(FRAME, null, null),
      ].sort(),
    );
    for (const piece of pieces.pieces) {
      expect(profileRefOf(piece.profile)).toBe(FRAME);
    }
  });

  it('one picked side colours the whole bar (C2b)', () => {
    expect(barGroupOf(FRAME, WHITE, null)).toBe(
      barGroupOf(FRAME, WHITE, WHITE),
    );
    expect(barGroupOf(FRAME, null, GREY)).toBe(barGroupOf(FRAME, GREY, GREY));
    expect(barGroupOf(FRAME, null, null)).toBe(`${FRAME}||`);
    const { pieces } = piecesOf(
      window('w1', 1200, WHITE, WHITE),
      window('w2', 1100, WHITE, null),
      window('w3', 1000, null, WHITE),
    );
    expect(profileQueue(pieces.pieces).map((q) => q.profile)).toEqual([
      barGroupOf(FRAME, WHITE, WHITE),
    ]);
  });

  it('never puts two colour pairs on one bar', async () => {
    const { pieces } = piecesOf(
      window('w1', 1200, WHITE, GREY),
      window('w2', 1100, WHITE, WHITE),
    );
    const result = await optimiseProject(pieces.pieces, settings);
    expect(result.profiles).toHaveLength(2);
    for (const profile of result.profiles) {
      const names = new Set(
        profile.best!.bars.flatMap((b) =>
          b.pieces.map((p) => p.ref.windowName),
        ),
      );
      expect(names.size).toBe(1);
    }
  });

  it('one colour pair everywhere solves exactly as one profile did', async () => {
    const { pieces } = piecesOf(
      window('w1', 1200, WHITE, GREY),
      window('w2', 1100, WHITE, GREY),
    );
    const grouped = await optimiseProject(pieces.pieces, settings);
    const plain = await optimiseProject(
      pieces.pieces.map((p) => ({ ...p, profile: FRAME })),
      settings,
    );
    expect(grouped.profiles).toHaveLength(1);
    expect(grouped.profiles[0].best).toEqual(plain.profiles[0].best);
    expect(grouped.total).toEqual(plain.total);
  });

  it('plan keys and profile numbers go by group', () => {
    const { base, pieces } = piecesOf(
      window('w1', 1200, WHITE, GREY),
      window('w2', 1200, GREY, GREY),
    );
    base.profiles = new Map([
      [FRAME, { profileNo: '1045' }],
    ]) as unknown as ReportInputs['profiles'];
    const keys = planKeysOf(base, pieces);
    expect([...keys.keys()].sort()).toEqual(
      [barGroupOf(FRAME, WHITE, GREY), barGroupOf(FRAME, GREY, GREY)].sort(),
    );
    // Same lengths in both pairs: same plan, but each group keeps its own.
    expect(new Set(keys.values()).size).toBe(1);
    expect(profileNoOf(base, barGroupOf(FRAME, WHITE, GREY))).toBe('1045');
  });

  it('a renamed colour code only refreshes the snapshot', () => {
    const before = inputs();
    before.windows = [window('w1', 1200, WHITE, GREY)];
    const after = inputs();
    after.windows = before.windows;
    before.colors = new Map([
      [WHITE, { code: 'RAL 9016', hex: '#f1f0ea', stamp: 'a' }],
    ]);
    after.colors = new Map([
      [WHITE, { code: 'RAL 9016 M', hex: '#f1f0ea', stamp: 'b' }],
    ]);
    expect(solveFingerprintOf(after)).toBe(solveFingerprintOf(before));
    expect(snapshotFingerprintOf(after)).not.toBe(
      snapshotFingerprintOf(before),
    );
    // GREY's row is gone: its ref stays, with no code.
    const pair = colorsOf(after, barGroupOf(FRAME, WHITE, GREY));
    expect(pair).toEqual({
      interior: { ref: WHITE, code: 'RAL 9016 M', hex: '#f1f0ea' },
      exterior: { ref: GREY, code: null, hex: null },
    });
    expect(recolored(before, pair).interior?.code).toBe('RAL 9016');
  });

  it('plans carry their colours: by code within a profile, no colour last', async () => {
    const { base, pieces } = piecesOf(
      window('w1', 1200, null, null),
      window('w2', 1100, WHITE, GREY),
      window('w3', 1000, GREY, GREY),
    );
    base.colors = new Map([
      [WHITE, { code: 'RAL 9016', hex: '#f1f0ea', stamp: 'a' }],
      [GREY, { code: 'RAL 7016', hex: '#383e42', stamp: 'a' }],
    ]);
    const result = await optimiseProject(pieces.pieces, settings);
    const report = reportSnapshotOf(base, pieces, result, new Date());
    const codes = report.plans.map((p) => [
      p.profile,
      p.colors?.interior?.code ?? null,
      p.colors?.exterior?.code ?? null,
    ]);
    expect(codes).toEqual([
      [FRAME, 'RAL 7016', 'RAL 7016'],
      [FRAME, 'RAL 9016', 'RAL 7016'],
      [FRAME, null, null],
    ]);
    expect(report.summary.profiles.map((p) => p.colors)).toEqual(
      report.plans.map((p) => p.colors),
    );
    expect(report.summary.members[0].profiles).toEqual([FRAME]);
  });
});
