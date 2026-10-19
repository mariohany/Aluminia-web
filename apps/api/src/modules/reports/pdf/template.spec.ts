import type { BarOptimiserSummary } from '@repo/types/reports';
import {
  optimiseProject,
  type ProjectPiece,
} from '@repo/bar-optimiser/project';
import type { PieceRef } from '../report-inputs';
import {
  mixText,
  renderBarOptimiserHtml,
  type BarOptimiserPdfData,
} from './template';

const settings = { lengths: [6500, 6000], kerfMm: 4, endTrimMm: 10 };

const piece = (
  windowName: string,
  member: PieceRef['member'],
  profile: string,
  lengthMm: number,
  count: number,
  position: PieceRef['at']['position'],
): ProjectPiece<PieceRef> => ({
  profile,
  member,
  lengthMm,
  count,
  ref: {
    windowId: windowName,
    windowName,
    member,
    at: {
      panelIndex: 0,
      sectionIndex: member === 'frame' ? null : 0,
      sashIndex: null,
      position,
    },
  },
});

async function data(language: 'en' | 'ar'): Promise<BarOptimiserPdfData> {
  const pieces = [
    piece('W-01 Living room', 'frame', 'platform:f', 2400, 4, 'top'),
    piece('W-01 Living room', 'frame', 'platform:f', 1500, 4, 'left'),
    piece('W-01 Living room', 'bead', 'platform:b', 334, 4, 'left'),
  ];
  const result = await optimiseProject(pieces, settings);
  const summary: BarOptimiserSummary = {
    stockLengthsMm: [6500, 6000],
    kerfMm: 4,
    endTrimMm: 10,
    windowCount: 1,
    unitCount: 4,
    total: { ...result.total },
    members: result.members.map((m) => ({
      ...m,
      single: m.single,
    })),
    profiles: result.profiles.map((p) => ({
      profile: p.profile,
      profileNo: p.profile === 'platform:f' ? 'F-60 <x>' : 'B-8',
      member: p.member,
      pieceCount: p.pieceCount,
      single: p.single,
      best: p.best ? { ...p.best, mix: p.best.mix } : null,
      tooLong: [],
    })),
    skipped: [],
    approximate: true,
  };
  return {
    language,
    companyName: 'Al-Noor & Sons',
    projectName: 'Villa',
    clientName: 'Ahmed',
    generatedAt: new Date('2026-10-15T12:00:00Z'),
    summary,
    plans: result.profiles.map((p) => ({
      profile: p.profile,
      profileNo: null,
      member: p.member,
      best: p.best,
    })),
    panelCounts: {},
  };
}

describe('bar optimiser PDF template', () => {
  it('mixText: longest stock first, zero counts dropped', () => {
    expect(mixText({ '6000': 7, '6500': 4, '7000': 0 })).toBe(
      '4×6500 + 7×6000',
    );
  });

  it('English: ltr, both pages, every member and the approximate note', async () => {
    const html = renderBarOptimiserHtml(await data('en'));
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('Bars needed per member');
    expect(html).toContain('Bar optimisation — cutting plan');
    expect(html).toContain('Frames');
    expect(html).toContain('Glazing beads');
    expect(html).toContain('Only 6500');
    expect(html).toContain('stand-in profile widths');
    // Escaped, never raw markup.
    expect(html).toContain('Al-Noor &amp; Sons');
    expect(html).toContain('F-60 &lt;x&gt;');
    // A bar per stock bar used, each piece labelled with its length.
    expect(html).toContain('>2400</text>');
    expect(html).toContain('W-01 · fr T');
  });

  it('prints the "A" mark without a logo, and the logo instead of it with one', async () => {
    const plain = renderBarOptimiserHtml(await data('en'));
    expect(plain).toContain('<div class="mark">A</div>');
    expect(plain).not.toContain('class="logo"');

    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const branded = renderBarOptimiserHtml({
      ...(await data('en')),
      logoDataUri: logo,
    });
    expect(branded).toContain(`<img class="logo" src="${logo}" alt="">`);
    expect(branded).not.toContain('<div class="mark">A</div>');
  });

  it('Arabic: rtl, Arabic headings, Latin digits, numbers isolated ltr', async () => {
    const html = renderBarOptimiserHtml(await data('ar'));
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('عدد الأعواد لكل عنصر');
    expect(html).toContain('البراويز');
    expect(html).toContain('الاسكواش');
    expect(html).toContain('6500 فقط');
    expect(html).not.toMatch(/[٠-٩]/);
    expect(html).toMatch(
      /<span class="res"><span class="num">[0-9×+ ]+ · [0-9.]+%<\/span>/,
    );
  });
});
