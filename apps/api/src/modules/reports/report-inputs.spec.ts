import type { Project } from '../../database/tenant/entities/project.entity';
import type { CutBar } from '@repo/bar-optimiser/optimise';
import {
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
