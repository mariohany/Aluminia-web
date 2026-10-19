import type {
  BarOptimiserSummary,
  ReportLanguage,
  ReportMember,
  ReportPlanTotals,
  StockMix,
} from '@repo/types/reports';
import type { CutBar, CutPlan } from '@repo/bar-optimiser/optimise';
import type { PieceRef } from '../report-inputs';
import { fontCss } from './fonts';
import { stringsFor, type PdfStrings } from '@repo/report-pdf/strings';

// The bar optimiser PDF as one HTML document, printed by Chrome
// (docs/reports_planing.md §8, D19): page 1 = the mock-up's option A
// (members table, order list), page 2 on = option B (every bar drawn to
// one scale, pieces in cutting order). Mock-ups: design canvas, page
// Reports, boards pdf-a-1 + pdf-b-2. Paper only — the PDF never themes.

export interface BarOptimiserPdfData {
  language: ReportLanguage;
  /** The printed name in the PDF's language (company profile, else the
   * account name). */
  companyName: string;
  /** The company logo (`data:` URI), shown instead of the "A" mark. */
  logoDataUri?: string | null;
  projectName: string;
  clientName: string;
  generatedAt: Date;
  summary: BarOptimiserSummary;
  /** Per profile, in report order, with the bars to draw. */
  plans: {
    profile: string;
    profileNo: string | null;
    member: ReportMember;
    best: CutPlan<PieceRef> | null;
  }[];
  /** Panels per window, for "panel 2 ·" in labels of multi-panel windows. */
  panelCounts: Record<string, number>;
}

const C = {
  ink: '#0E1218',
  mute: '#5F646A',
  line: '#DBDEE2',
  soft: '#F2F3F6',
  accent: '#D04400',
  accentSoft: '#FBE9E0',
  piece: '#E4E7EB',
  trim: '#C9CDD3',
};

export function renderBarOptimiserHtml(data: BarOptimiserPdfData): string {
  const s = stringsFor(data.language);
  const sum = data.summary;
  const lengths = sum.stockLengthsMm;
  const latinFirst = data.language === 'en';
  const family = latinFirst
    ? `'Geist', 'IBM Plex Sans Arabic', sans-serif`
    : `'IBM Plex Sans Arabic', 'Geist', sans-serif`;

  const date = new Intl.DateTimeFormat(s.dateLocale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(data.generatedAt);

  return `<!doctype html>
<html lang="${data.language}" dir="${s.dir}">
<head>
<meta charset="utf-8">
<title>${esc(s.title)} — ${esc(data.projectName)}</title>
<style>
${fontCss()}
@page { size: A4; margin: 14mm 14mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: ${family}; font-size: 10.5px; color: ${C.ink}; line-height: 1.45; }
.num { font-family: 'Geist Mono', monospace; direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
header { display: flex; align-items: flex-start; gap: 12px; padding-bottom: 10px; border-bottom: 2px solid ${C.ink}; }
.logo { width: 40px; height: 40px; object-fit: contain; flex-shrink: 0; }
.mark { width: 30px; height: 30px; border-radius: 7px; background: ${C.accent}; color: #fff; display: flex; align-items: center; justify-content: center; font: 700 15px 'Geist', sans-serif; flex-shrink: 0; }
.head-text { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.company { font-size: 9.5px; color: ${C.mute}; }
h1 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.subtitle { font-size: 10px; color: ${C.mute}; }
.date { font-size: 9.5px; color: ${C.mute}; white-space: nowrap; }
.meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 9px 0; border-bottom: 1px solid ${C.line}; margin-bottom: 4px; }
.meta .k { font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.mute}; }
.meta .v { font-size: 10.5px; font-weight: 500; }
h2 { margin: 14px 0 6px; font-size: 12px; font-weight: 700; display: flex; gap: 6px; align-items: baseline; break-after: avoid; }
h2 .n { font: 600 9px 'Geist Mono', monospace; color: ${C.accent}; }
table { width: 100%; border-collapse: collapse; }
th { padding: 5px 6px; font-size: 8.5px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: ${C.mute}; text-align: start; border-bottom: 1.5px solid ${C.ink}; white-space: nowrap; }
td { padding: 5px 6px; font-size: 10px; border-bottom: 1px solid ${C.line}; white-space: nowrap; }
th.r, td.r { text-align: end; }
td.best { background: ${C.accentSoft}; color: ${C.accent}; font-weight: 700; white-space: normal; }
td .pct { font-size: 8.5px; color: ${C.mute}; }
td.best .pct { color: ${C.accent}; }
tr.total td { font-weight: 700; border-bottom: 0; }
tr { break-inside: avoid; }
.note { margin: 6px 0 0; font-size: 9px; color: ${C.mute}; }
.box { margin-top: 10px; padding: 7px 9px; border-radius: 6px; background: ${C.soft}; font-size: 9px; }
.box b { display: block; margin-bottom: 3px; font-size: 9.5px; }
.box ul { margin: 0; padding-inline-start: 14px; }
.plan { break-before: page; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 8.5px; color: ${C.mute}; margin: 8px 0 4px; }
.legend i { display: inline-block; width: 13px; height: 8px; margin-inline-end: 4px; vertical-align: -1px; }
.profile { margin-top: 12px; break-inside: avoid-page; }
.profile-head { display: flex; align-items: baseline; gap: 8px; padding-top: 6px; border-top: 1px solid ${C.line}; break-after: avoid; }
.profile-head .no { font: 700 11px 'Geist Mono', monospace; }
.profile-head .mem { font-size: 10px; }
.profile-head .res { margin-inline-start: auto; font-size: 9.5px; font-weight: 600; color: ${C.accent}; }
.bar { display: flex; align-items: center; gap: 6px; margin-top: 4px; break-inside: avoid; direction: ltr; }
.bar .i { font: 400 8.5px 'Geist Mono', monospace; color: ${C.mute}; width: 16px; text-align: right; }
svg text { font-family: 'Geist Mono', 'IBM Plex Sans Arabic', monospace; }
svg text.lbl { font-family: ${family}; }
</style>
</head>
<body>
<section>
${header(data, s.title, s.subtitle, date)}
<div class="meta">
  ${metaCell(s.client, esc(data.clientName))}
  ${metaCell(s.project, esc(data.projectName))}
  ${metaCell(s.windows, esc(s.windowsValue(sum.windowCount, sum.unitCount)))}
  ${metaCell(s.settings, esc(s.settingsValue(lengths.join(' / '), sum.kerfMm, sum.endTrimMm)))}
</div>
<h2><span class="n">01</span>${esc(s.membersHeading)}</h2>
${membersTable(s, sum)}
<p class="note">${esc(s.membersNote)} ${esc(s.wasteNote)}</p>
<h2><span class="n">02</span>${esc(s.ordersHeading)}</h2>
${ordersTable(s, sum, data)}
${sum.approximate ? `<p class="note">${esc(s.approximate)}</p>` : ''}
${skippedBox(s, data)}
${tooLongBox(s, data)}
</section>
${cuttingPlan(s, data, date)}
</body>
</html>`;
}

/** Page numbers in the footer: digits only, so no font is needed there
 * (Chrome renders header/footer templates without the page's fonts). */
export function footerTemplate(): string {
  return `<div style="width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:${C.mute}"><span>Aluminia</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

function header(
  data: BarOptimiserPdfData,
  title: string,
  subtitle: string,
  date: string,
): string {
  const mark = data.logoDataUri
    ? `<img class="logo" src="${esc(data.logoDataUri)}" alt="">`
    : `<div class="mark">A</div>`;
  return `<header>
  ${mark}
  <div class="head-text">
    <span class="company">${esc(data.companyName)}</span>
    <h1>${esc(title)}</h1>
    <span class="subtitle">${esc(subtitle)}</span>
  </div>
  <span class="date">${esc(date)}</span>
</header>`;
}

function metaCell(k: string, v: string): string {
  return `<div><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
}

function membersTable(s: PdfStrings, sum: BarOptimiserSummary): string {
  const lengths = sum.stockLengthsMm;
  const rows = sum.members
    .map(
      (m) => `<tr>
  <td><b>${esc(s.groups[m.member])}</b></td>
  <td class="r num">${m.pieceCount}</td>
  ${lengths.map((l) => planCell(m.single[String(l)] ?? null)).join('')}
  ${planCell(m.best, m.best.mix, true)}
</tr>`,
    )
    .join('');
  const totalSingle = (l: number): ReportPlanTotals | null => {
    const plans = sum.members.map((m) => m.single[String(l)] ?? null);
    if (plans.some((p) => p === null)) return null;
    const bought = plans.reduce((n, p) => n + p!.boughtMm, 0);
    const waste = plans.reduce((n, p) => n + p!.wasteMm, 0);
    return {
      barCount: plans.reduce((n, p) => n + p!.barCount, 0),
      boughtMm: bought,
      wasteMm: waste,
      wastePct: bought ? (waste / bought) * 100 : 0,
    };
  };
  return `<table>
<thead><tr>
  <th>${esc(s.colMembers)}</th><th class="r">${esc(s.colPieces)}</th>
  ${lengths.map((l) => `<th class="r">${esc(s.colOnly(l))}</th>`).join('')}
  <th class="r">${esc(s.colLeastWaste)}</th>
</tr></thead>
<tbody>${rows}
<tr class="total">
  <td>${esc(s.total)}</td><td class="r num">${sum.total.pieceCount}</td>
  ${lengths.map((l) => planCell(totalSingle(l))).join('')}
  ${planCell(sum.total, sum.total.mix, true)}
</tr>
</tbody></table>`;
}

function ordersTable(
  s: PdfStrings,
  sum: BarOptimiserSummary,
  data: BarOptimiserPdfData,
): string {
  const lengths = sum.stockLengthsMm;
  const rows = sum.profiles
    .map((p) => {
      const plan = data.plans.find((x) => x.profile === p.profile)?.best;
      const metres = plan ? (plan.piecesMm / 1000).toFixed(2) : '—';
      return `<tr>
  <td class="num"><b>${esc(p.profileNo ?? '—')}</b></td>
  <td>${esc(s.member[p.member])}</td>
  <td class="r num">${p.pieceCount}</td>
  <td class="r num">${metres} m</td>
  ${lengths.map((l) => planCell(p.single[String(l)] ?? null)).join('')}
  ${p.best ? planCell(p.best, p.best.mix, true) : '<td class="r">—</td>'}
</tr>`;
    })
    .join('');
  return `<table>
<thead><tr>
  <th>${esc(s.colProfile)}</th><th>${esc(s.colMember)}</th>
  <th class="r">${esc(s.colPieces)}</th><th class="r">${esc(s.colInWindows)}</th>
  ${lengths.map((l) => `<th class="r">${esc(s.colOnly(l))}</th>`).join('')}
  <th class="r">${esc(s.colOrder)}</th>
</tr></thead>
<tbody>${rows || `<tr><td colspan="${5 + lengths.length}">${esc(s.noPieces)}</td></tr>`}</tbody></table>`;
}

/** "bars · waste%", or the mix ("4×6500 + 7×6000 · 2.6%") when given.
 * A long mix (many stock lengths) is wider than its column: the best
 * cell wraps, but only after a "+", so "6×7000 +" stays whole and the
 * order is never cut off at the page edge (bug-119). */
function planCell(
  plan: ReportPlanTotals | null,
  mix?: StockMix,
  best = false,
): string {
  if (!plan) return `<td class="r num">—</td>`;
  const what = mix
    ? mixText(mix).replace(/ \+ /g, '&nbsp;+ ')
    : String(plan.barCount);
  return `<td class="r num${best ? ' best' : ''}">${what}&nbsp;<span class="pct">·&nbsp;${plan.wastePct.toFixed(1)}%</span></td>`;
}

export function mixText(mix: StockMix): string {
  return Object.entries(mix)
    .map(([length, n]) => [Number(length), n] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([length, n]) => `${n}×${length}`)
    .join(' + ');
}

function skippedBox(s: PdfStrings, data: BarOptimiserPdfData): string {
  const skipped = data.summary.skipped;
  if (!skipped.length) return '';
  const items = skipped
    .map(
      (p) =>
        `<li>${esc(p.windowName)} · ${esc(s.partLabel(p.member, p.at, data.panelCounts[p.windowId] ?? 1))}</li>`,
    )
    .join('');
  return `<div class="box"><b>${esc(s.skippedHeading)}</b>${esc(s.skippedNote)}<ul>${items}</ul></div>`;
}

function tooLongBox(s: PdfStrings, data: BarOptimiserPdfData): string {
  const items = data.summary.profiles.flatMap((p) =>
    p.tooLong.map(
      (t) =>
        `<li><span class="num">${esc(p.profileNo ?? '—')} · ${t.lengthMm} mm × ${t.count}</span> · ${esc(t.windowName)}</li>`,
    ),
  );
  if (!items.length) return '';
  return `<div class="box"><b>${esc(s.tooLongHeading)}</b>${esc(s.tooLongNote)}<ul>${items.join('')}</ul></div>`;
}

function cuttingPlan(
  s: PdfStrings,
  data: BarOptimiserPdfData,
  date: string,
): string {
  const plans = data.plans.filter((p) => p.best && p.best.bars.length);
  if (!plans.length) return '';
  const longest = Math.max(
    ...plans.flatMap((p) => p.best!.bars.map((b) => b.stockMm)),
  );
  const trim = data.summary.endTrimMm;
  const legend = `<div class="legend">
  <span><i style="background:${C.piece};border:1px solid ${C.ink}"></i>${esc(s.legendPiece)}</span>
  <span><i style="background:${C.accentSoft};border:1px dashed ${C.accent}"></i>${esc(s.legendWaste)}</span>
  <span><i style="background:${C.trim}"></i>${esc(s.legendTrim(trim))}</span>
  <span>${esc(s.legendScale)}</span>
</div>`;
  const blocks = plans
    .map((p) => {
      const best = p.best!;
      const bars = best.bars
        .map(
          (bar, i) =>
            `<div class="bar"><span class="i">${i + 1}</span>${barSvg(bar, longest, data, s)}</div>`,
        )
        .join('');
      return `<div class="profile">
  <div class="profile-head">
    <span class="no">${esc(p.profileNo ?? '—')}</span>
    <span class="mem">${esc(s.member[p.member])}</span>
    <span class="res"><span class="num">${mixText(best.mix)} · ${best.wastePct.toFixed(1)}%</span> ${esc(s.waste)}</span>
  </div>
  ${bars}
</div>`;
    })
    .join('');
  return `<section class="plan">
${header(data, s.planTitle, s.planSubtitle, date)}
${legend}
${blocks}
</section>`;
}

const BAR_W = 640;
const BAR_H = 26;

/** One bar to scale: trim · pieces with their kerfs · waste · trim. Drawn
 * left to right in both languages, as the saw cuts it. Every piece shows
 * its length; its label (window · part, D26) is shortened to fit. */
function barSvg(
  bar: CutBar<PieceRef>,
  longest: number,
  data: BarOptimiserPdfData,
  s: PdfStrings,
): string {
  const sum = data.summary;
  const scale = (BAR_W - 64) / longest;
  const trimW = sum.endTrimMm * scale;
  const kerfW = sum.kerfMm * scale;
  const w = bar.stockMm * scale;
  const parts: string[] = [
    `<rect x="0" y="0" width="${w.toFixed(1)}" height="${BAR_H}" fill="${C.soft}" stroke="${C.line}"/>`,
    `<rect x="0" y="0" width="${trimW.toFixed(1)}" height="${BAR_H}" fill="${C.trim}"/>`,
  ];
  let x = trimW;
  for (const piece of bar.pieces) {
    const pw = piece.lengthMm * scale;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="2" width="${pw.toFixed(1)}" height="${BAR_H - 4}" fill="${C.piece}" stroke="${C.ink}" stroke-width="0.7"/>`,
    );
    const cx = (x + pw / 2).toFixed(1);
    const roomy = pw > 46;
    parts.push(
      `<text x="${cx}" y="${pw > 20 ? 11 : 15}" text-anchor="middle" font-size="${roomy ? 8.5 : 7}" font-weight="600" fill="${C.ink}">${piece.lengthMm}</text>`,
    );
    const label = fitLabel(shortLabel(piece.ref, s), pw);
    if (label && pw > 20) {
      parts.push(
        `<text class="lbl" x="${cx}" y="20.5" text-anchor="middle" font-size="${roomy ? 6.8 : 6}" fill="${C.mute}">${esc(label)}</text>`,
      );
    }
    x += pw + kerfW;
  }
  const offcutW = Math.max(bar.offcutMm * scale, 0);
  parts.push(
    `<rect x="${x.toFixed(1)}" y="2" width="${offcutW.toFixed(1)}" height="${BAR_H - 4}" fill="${C.accentSoft}" stroke="${C.accent}" stroke-width="0.7" stroke-dasharray="3 2"/>`,
    `<rect x="${(w - trimW).toFixed(1)}" y="0" width="${trimW.toFixed(1)}" height="${BAR_H}" fill="${C.trim}"/>`,
    `<text x="${(w + 6).toFixed(1)}" y="12" font-size="8" font-weight="600" fill="${C.accent}">${bar.wasteMm}</text>`,
    `<text class="lbl" x="${(w + 6).toFixed(1)}" y="21" font-size="6.5" fill="${C.accent}">${esc(s.wasteShort)}</text>`,
    `<text x="${(w - trimW - 2).toFixed(1)}" y="-2" font-size="6" fill="${C.mute}" text-anchor="end">${bar.stockMm}</text>`,
  );
  return `<svg width="${BAR_W}" height="${BAR_H + 8}" viewBox="0 -6 ${BAR_W} ${BAR_H + 8}" role="img" aria-label="${bar.stockMm} mm">${parts.join('')}</svg>`;
}

/** "W-01 · sa B L": a window name like "W-01 Living room" keeps its
 * leading code; otherwise the whole name, before the part. */
function shortLabel(ref: PieceRef, s: PdfStrings): string {
  const [first, ...rest] = ref.windowName.trim().split(/\s+/);
  const windowShort = rest.length && /\d/.test(first) ? first : ref.windowName;
  return `${windowShort} · ${s.partShort(ref.member, ref.at)}`;
}

/** As much of the label as fits in `widthPx` at ~3.9 px per character. */
function fitLabel(label: string, widthPx: number): string | null {
  const budget = Math.floor((widthPx - 4) / 3.9);
  if (budget < 3) return null;
  if (label.length <= budget) return label;
  return `${label.slice(0, Math.max(budget - 1, 1))}…`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
