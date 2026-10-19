import type { Project } from '../../database/tenant/entities/project.entity';
import {
  snapshotFingerprintOf,
  solveFingerprintOf,
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
