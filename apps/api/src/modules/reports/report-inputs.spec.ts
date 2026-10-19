import { ReportLanguage } from '@repo/types/reports';
import type { Project } from '../../database/tenant/entities/project.entity';
import {
  printFingerprintOf,
  solveFingerprintOf,
  type ReportInputs,
} from './report-inputs';

// Two fingerprints (docs/browser_solve_planing.md §6): what changes the
// cutting plan means solve again; what only changes the paper means
// print again from the stored solve.

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
  const en = printFingerprintOf(base, ReportLanguage.EN);

  it('a window or settings change means solve (and print) again', () => {
    const edited = inputs();
    edited.windows[0].updatedAt = '2026-10-03T10:00:00.000Z';
    expect(solveFingerprintOf(edited)).not.toBe(solve);
    expect(printFingerprintOf(edited, ReportLanguage.EN)).not.toBe(en);

    const saw = inputs();
    saw.settings.updatedAt = at('2026-10-03T10:00:00Z');
    expect(solveFingerprintOf(saw)).not.toBe(solve);
  });

  it('the letterhead, the project, the client or the language only reprint', () => {
    const logo = inputs();
    logo.letterhead.updatedAt = at('2026-10-03T10:00:00Z');
    const renamed = inputs();
    renamed.project.updatedAt = at('2026-10-03T10:00:00Z');
    const client = inputs();
    client.project.client.updatedAt = at('2026-10-03T10:00:00Z');

    for (const changed of [logo, renamed, client]) {
      expect(solveFingerprintOf(changed)).toBe(solve);
      expect(printFingerprintOf(changed, ReportLanguage.EN)).not.toBe(en);
    }
    expect(printFingerprintOf(base, ReportLanguage.AR)).not.toBe(en);
  });
});
