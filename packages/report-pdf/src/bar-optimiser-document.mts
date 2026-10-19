import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { Document, Image, Page, Rect, Svg, Text, View, type DocumentProps } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'
import type {
  BarOptimiserReport,
  BarOptimiserReportBar,
  BarOptimiserReportPiece,
  BarOptimiserSummary,
  ReportLanguage,
  ReportPlanTotals,
  StockMix,
} from '@repo/types/reports'
import { FONT_FAMILY } from './fonts.mts'
import { stringsFor, type PdfStrings } from './strings.ts'

// The bar optimiser PDF, drawn in the user's browser by @react-pdf
// (docs/browser_pdf_planing.md; layout from docs/reports_planing.md D19,
// the API's former HTML template): page 1 = members table + order list,
// then the cutting plan, every bar to one scale. Paper only: never themed.
//
// Right to left: every Arabic-language text goes through `text()`, which
// sets `direction` — @react-pdf orders mixed Arabic + numbers correctly
// only then (the experiment's first try printed "أكتوبر 2026 19").

export interface BarOptimiserPdfInput {
  language: ReportLanguage
  /** Frozen at Generate (P6). */
  report: BarOptimiserReport
  /** Always the latest (P7): the printed company names. */
  company: { enName: string; arName: string | null }
  /** PNG or JPEG data URI, or null for the "A" mark. */
  logo: string | null
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
}

/** The old template's CSS pixels (96 dpi) in PDF points. */
const px = (n: number) => n * 0.75
/** A4 width minus 14 mm each side, in CSS pixels. */
const CONTENT_PX = 793.7 - 2 * 52.9

export function barOptimiserDocument(input: BarOptimiserPdfInput): ReactElement<DocumentProps> {
  const s = stringsFor(input.language)
  const d = new Dir(s, input.language)
  const { report } = input
  const sum = report.summary
  const arabic = input.language === 'ar'
  const name = (n: { enName: string; arName: string | null } | null) =>
    n ? (arabic && n.arName) || n.enName : ''
  const date = new Intl.DateTimeFormat(s.dateLocale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(report.generatedAt),
  )
  const head = (title: string, subtitle: string) =>
    header(d, { company: name(input.company), title, subtitle, date, logo: input.logo })
  const page = (...children: ReactNode[]) =>
    h(
      Page,
      {
        size: 'A4',
        style: { paddingTop: px(52.9), paddingBottom: px(60.5), paddingHorizontal: px(52.9), fontFamily: d.family, color: C.ink, fontSize: px(10.5) },
      },
      ...children,
      footer(),
    )

  return h(
    Document,
    { title: `${s.title} — ${name(report.project)}`, creator: 'Aluminia', producer: 'Aluminia' },
    page(
      head(s.title, s.subtitle),
      d.row(
        { gap: px(8), paddingVertical: px(9), borderBottomWidth: px(1), borderBottomColor: C.line, marginBottom: px(4) },
        meta(d, s.client, name(report.client)),
        meta(d, s.project, name(report.project)),
        meta(d, s.windows, s.windowsValue(sum.windowCount, sum.unitCount)),
        meta(d, s.settings, s.settingsValue(sum.stockLengthsMm.join(' / '), sum.kerfMm, sum.endTrimMm)),
      ),
      heading(d, '01', s.membersHeading),
      membersTable(d, s, sum),
      d.text(`${s.membersNote} ${s.wasteNote}`, { fontSize: px(9), color: C.mute, marginTop: px(6) }),
      heading(d, '02', s.ordersHeading),
      ordersTable(d, s, report),
      sum.approximate ? d.text(s.approximate, { fontSize: px(9), color: C.mute, marginTop: px(6) }) : null,
      skippedBox(d, s, report),
      tooLongBox(d, s, report),
    ),
    ...cuttingPlan(d, s, report, page, head),
  )
}

/** Direction-aware building blocks for one language. */
class Dir {
  readonly rtl: boolean
  readonly family: string[]
  readonly s: PdfStrings
  constructor(s: PdfStrings, language: ReportLanguage) {
    this.s = s
    this.rtl = s.dir === 'rtl'
    this.family =
      language === 'ar' ? [FONT_FAMILY.arabic, FONT_FAMILY.sans] : [FONT_FAMILY.sans, FONT_FAMILY.arabic]
  }
  /** Where a line starts: right in Arabic. */
  get start(): 'left' | 'right' {
    return this.rtl ? 'right' : 'left'
  }
  /** Where numbers align (the old `text-align: end`). */
  get end(): 'left' | 'right' {
    return this.rtl ? 'left' : 'right'
  }
  /** A row that runs in reading order. */
  row(style: Style, ...children: ReactNode[]) {
    return h(View, { style: { flexDirection: this.rtl ? 'row-reverse' : 'row', ...style } }, ...children)
  }
  /** Words in the document's language, bidi-ordered (see the file comment). */
  text(content: ReactNode, style: Style = {}) {
    return h(Text, { style: { fontFamily: this.family, direction: this.s.dir, textAlign: this.start, ...style } }, content)
  }
  /** Numbers and codes: mono, always left to right. */
  num(content: ReactNode, style: Style = {}) {
    return h(Text, { style: { fontFamily: [FONT_FAMILY.mono, FONT_FAMILY.arabic], direction: 'ltr', ...style } }, content)
  }
}

function header(
  d: Dir,
  p: { company: string; title: string; subtitle: string; date: string; logo: string | null },
) {
  const mark = p.logo
    ? h(Image, { src: p.logo, style: { width: px(40), height: px(40), objectFit: 'contain' } })
    : h(
        View,
        { style: { width: px(30), height: px(30), borderRadius: px(7), backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' } },
        h(Text, { style: { fontFamily: FONT_FAMILY.sans, fontWeight: 700, fontSize: px(15), color: '#FFFFFF' } }, 'A'),
      )
  return d.row(
    { alignItems: 'flex-start', gap: px(12), paddingBottom: px(10), borderBottomWidth: px(2), borderBottomColor: C.ink },
    mark,
    h(
      View,
      { style: { flex: 1, gap: px(1) } },
      d.text(p.company, { fontSize: px(9.5), color: C.mute }),
      d.text(p.title, { fontSize: px(17), fontWeight: 700 }),
      d.text(p.subtitle, { fontSize: px(10), color: C.mute }),
    ),
    d.text(p.date, { fontSize: px(9.5), color: C.mute }),
  )
}

function meta(d: Dir, key: string, value: string) {
  return h(
    View,
    { style: { flex: 1 } },
    d.text(key, { fontSize: px(8), color: C.mute, textTransform: 'uppercase', letterSpacing: px(0.5) }),
    d.text(value, { fontSize: px(10.5) }),
  )
}

function heading(d: Dir, n: string, title: string) {
  return d.row(
    { gap: px(6), marginTop: px(14), marginBottom: px(6), alignItems: 'flex-end' },
    d.num(n, { fontSize: px(9), fontWeight: 600, color: C.accent, marginBottom: px(1.5) }),
    d.text(title, { fontSize: px(12), fontWeight: 700 }),
  )
}

/** "4×6500 + 7×6000": longest first, zero counts dropped. */
export function mixText(mix: StockMix): string {
  return Object.entries(mix)
    .map(([length, n]) => [Number(length), n] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([length, n]) => `${n}×${length}`)
    .join(' + ')
}

const CELL: Style = { paddingVertical: px(5), paddingHorizontal: px(6) }

/** One table cell: a fixed width, or `flex` for the column that takes the
 * leftover width (the orange one, bug-119). */
function cell(content: ReactElement, width: number | 'flex', style: Style = {}) {
  return h(
    View,
    { style: { ...CELL, ...(width === 'flex' ? { flex: 1 } : { width: px(width) }), justifyContent: 'center', ...style } },
    content,
  )
}

function th(d: Dir, label: string, width: number | 'flex', numeric = false) {
  return cell(
    d.text(label, {
      fontSize: px(8.5),
      fontWeight: 600,
      color: C.mute,
      textTransform: 'uppercase',
      letterSpacing: px(0.25),
      textAlign: numeric ? d.end : d.start,
    }),
    width,
  )
}

/** "bars · waste%", or the mix ("6×7000 + 2×5000 · 5.4%"). The mix is
 * laid out as separate blocks — "6×7000 +", "2×5000 · 5.4%" — that wrap
 * as wholes, so a long order wraps only after a "+", its last length keeps
 * its waste %, and nothing runs off the page (bug-119). (A non-breaking
 * space can't do this: @react-pdf breaks there anyway and draws a "-".)
 * Numbers read left to right in both languages and align to the end. */
function planCell(d: Dir, plan: ReportPlanTotals | null, width: number | 'flex', mix?: StockMix, best = false) {
  const style: Style = { fontSize: px(10), ...(best ? { color: C.accent, fontWeight: 700 } : {}) }
  if (!plan) return cell(d.num('—', { ...style, textAlign: d.end }), width)
  const terms = mix ? mixText(mix).split(' + ') : [String(plan.barCount)]
  const pct = h(Text, { key: 'pct', style: { fontSize: px(8.5), color: best ? C.accent : C.mute } }, ` · ${plan.wastePct.toFixed(1)}%`)
  const blocks = terms.map((term, i) =>
    i < terms.length - 1 ? d.num(`${term} +`, style) : d.num([term, pct], style),
  )
  return cell(
    h(
      View,
      { style: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: d.rtl ? 'flex-start' : 'flex-end', columnGap: px(6) } },
      ...blocks,
    ),
    width,
    best ? { backgroundColor: C.accentSoft } : {},
  )
}

function tableRow(d: Dir, cells: ReactElement[], last = false, bold = false) {
  return h(
    View,
    {
      wrap: false,
      style: {
        flexDirection: d.rtl ? 'row-reverse' : 'row',
        alignItems: 'stretch',
        borderBottomWidth: last ? 0 : px(1),
        borderBottomColor: C.line,
        ...(bold ? { fontWeight: 700 } : {}),
      },
    },
    ...cells,
  )
}

function headRow(d: Dir, cells: ReactElement[]) {
  return h(
    View,
    { style: { flexDirection: d.rtl ? 'row-reverse' : 'row', borderBottomWidth: px(1.5), borderBottomColor: C.ink } },
    ...cells,
  )
}

/** Each single-length column's width: as wide as a cell needs, narrower
 * when many stock lengths must share the page. */
function singleWidth(fixed: number, minLast: number, n: number, max: number): number {
  return n ? Math.min(max, (CONTENT_PX - fixed - minLast) / n) : max
}

function membersTable(d: Dir, s: PdfStrings, sum: BarOptimiserSummary) {
  const lengths = sum.stockLengthsMm
  const W = { name: 128, pieces: 46 }
  const single = singleWidth(W.name + W.pieces, 190, lengths.length, 86)
  const totalSingle = (l: number): ReportPlanTotals | null => {
    const plans = sum.members.map((m) => m.single[String(l)] ?? null)
    if (plans.some((p) => p === null)) return null
    const bought = plans.reduce((n, p) => n + p!.boughtMm, 0)
    const waste = plans.reduce((n, p) => n + p!.wasteMm, 0)
    return {
      barCount: plans.reduce((n, p) => n + p!.barCount, 0),
      boughtMm: bought,
      wasteMm: waste,
      wastePct: bought ? (waste / bought) * 100 : 0,
    }
  }
  return h(
    View,
    null,
    headRow(d, [
      th(d, s.colMembers, W.name),
      th(d, s.colPieces, W.pieces, true),
      ...lengths.map((l) => th(d, s.colOnly(l), single, true)),
      th(d, s.colLeastWaste, 'flex', true),
    ]),
    ...sum.members.map((m) =>
      tableRow(d, [
        cell(d.text(s.groups[m.member], { fontWeight: 700, fontSize: px(10) }), W.name),
        cell(d.num(String(m.pieceCount), { textAlign: d.end, fontSize: px(10) }), W.pieces),
        ...lengths.map((l) => planCell(d, m.single[String(l)] ?? null, single)),
        planCell(d, m.best, 'flex', m.best.mix, true),
      ]),
    ),
    tableRow(
      d,
      [
        cell(d.text(s.total, { fontWeight: 700, fontSize: px(10) }), W.name),
        cell(d.num(String(sum.total.pieceCount), { textAlign: d.end, fontSize: px(10), fontWeight: 700 }), W.pieces),
        ...lengths.map((l) => planCell(d, totalSingle(l), single)),
        planCell(d, sum.total, 'flex', sum.total.mix, true),
      ],
      true,
      true,
    ),
  )
}

function ordersTable(d: Dir, s: PdfStrings, report: BarOptimiserReport) {
  const sum = report.summary
  const lengths = sum.stockLengthsMm
  const W = { profile: 92, member: 96, pieces: 40, metres: 66 }
  const single = singleWidth(W.profile + W.member + W.pieces + W.metres, 120, lengths.length, 76)
  const rows = sum.profiles.map((p) => {
    const plan = report.plans.find((x) => x.profile === p.profile)?.best
    return tableRow(d, [
      cell(d.num(p.profileNo ?? '—', { fontWeight: 700, fontSize: px(10), textAlign: d.start }), W.profile),
      cell(d.text(s.member[p.member], { fontSize: px(10) }), W.member),
      cell(d.num(String(p.pieceCount), { textAlign: d.end, fontSize: px(10) }), W.pieces),
      cell(d.num(plan ? `${(plan.piecesMm / 1000).toFixed(2)} m` : '—', { textAlign: d.end, fontSize: px(10) }), W.metres),
      ...lengths.map((l) => planCell(d, p.single[String(l)] ?? null, single)),
      p.best ? planCell(d, p.best, 'flex', p.best.mix, true) : cell(d.num('—', { textAlign: d.end }), 'flex'),
    ])
  })
  return h(
    View,
    null,
    headRow(d, [
      th(d, s.colProfile, W.profile),
      th(d, s.colMember, W.member),
      th(d, s.colPieces, W.pieces, true),
      th(d, s.colInWindows, W.metres, true),
      ...lengths.map((l) => th(d, s.colOnly(l), single, true)),
      th(d, s.colOrder, 'flex', true),
    ]),
    ...(rows.length ? rows : [d.text(s.noPieces, { padding: px(6) })]),
  )
}

function box(d: Dir, title: string, note: string, items: ReactNode[]) {
  return h(
    View,
    { wrap: false, style: { marginTop: px(10), paddingVertical: px(7), paddingHorizontal: px(9), borderRadius: px(6), backgroundColor: C.soft } },
    d.text(title, { fontSize: px(9.5), fontWeight: 700, marginBottom: px(3) }),
    d.text(note, { fontSize: px(9) }),
    ...items.map((item, i) => d.row({ gap: px(4), marginTop: px(2) }, d.text('•', { fontSize: px(9) }), h(View, { key: i, style: { flex: 1 } }, item))),
  )
}

function skippedBox(d: Dir, s: PdfStrings, report: BarOptimiserReport) {
  const skipped = report.summary.skipped
  if (!skipped.length) return null
  return box(
    d,
    s.skippedHeading,
    s.skippedNote,
    skipped.map((p) =>
      d.text(`${p.windowName} · ${s.partLabel(p.member, p.at, report.panelCounts[p.windowId] ?? 1)}`, { fontSize: px(9) }),
    ),
  )
}

function tooLongBox(d: Dir, s: PdfStrings, report: BarOptimiserReport) {
  const items = report.summary.profiles.flatMap((p) =>
    p.tooLong.map((t) =>
      d.row(
        { gap: px(3) },
        d.num(`${p.profileNo ?? '—'} · ${t.lengthMm} mm × ${t.count}`, { fontSize: px(9) }),
        d.text(`· ${t.windowName}`, { fontSize: px(9) }),
      ),
    ),
  )
  if (!items.length) return null
  return box(d, s.tooLongHeading, s.tooLongNote, items)
}

const BAR_W = 640
const BAR_H = 26

function cuttingPlan(
  d: Dir,
  s: PdfStrings,
  report: BarOptimiserReport,
  page: (...children: ReactNode[]) => ReactElement,
  head: (title: string, subtitle: string) => ReactElement,
): ReactElement[] {
  const plans = report.plans.filter((p) => p.best && p.best.bars.length)
  if (!plans.length) return []
  const sum = report.summary
  const longest = Math.max(...plans.flatMap((p) => p.best!.bars.map((b) => b.stockMm)))
  const legendItem = (box: Style, label: string) =>
    d.row({ gap: px(4), alignItems: 'center' }, h(View, { style: { width: px(13), height: px(8), ...box } }), d.text(label, { fontSize: px(8.5), color: C.mute }))
  return [
    page(
      head(s.planTitle, s.planSubtitle),
      d.row(
        { gap: px(12), flexWrap: 'wrap', marginTop: px(8), marginBottom: px(4) },
        legendItem({ backgroundColor: C.piece, borderWidth: px(1), borderColor: C.ink }, s.legendPiece),
        legendItem({ backgroundColor: C.accentSoft, borderWidth: px(1), borderColor: C.accent, borderStyle: 'dashed' }, s.legendWaste),
        legendItem({ backgroundColor: C.trim }, s.legendTrim(sum.endTrimMm)),
        d.text(s.legendScale, { fontSize: px(8.5), color: C.mute }),
      ),
      ...plans.map((p) => {
        const best = p.best!
        return h(
          View,
          { key: p.profile, style: { marginTop: px(12) } },
          d.row(
            { gap: px(8), alignItems: 'flex-end', paddingTop: px(6), borderTopWidth: px(1), borderTopColor: C.line },
            d.num(p.profileNo ?? '—', { fontSize: px(11), fontWeight: 700 }),
            d.text(s.member[p.member], { fontSize: px(10) }),
            h(View, { style: { flex: 1 } }),
            d.row(
              { gap: px(3) },
              d.num(`${mixText(best.mix)} · ${best.wastePct.toFixed(1)}%`, { fontSize: px(9.5), fontWeight: 600, color: C.accent }),
              d.text(s.waste, { fontSize: px(9.5), fontWeight: 600, color: C.accent }),
            ),
          ),
          ...best.bars.map((bar, i) => barRow(d, s, sum, bar, i, longest)),
        )
      }),
    ),
  ]
}

/** One bar to scale: trim · pieces with their kerfs · offcut · trim, left
 * to right in both languages, as the saw cuts it (D19). */
function barRow(d: Dir, s: PdfStrings, sum: BarOptimiserSummary, bar: BarOptimiserReportBar, index: number, longest: number) {
  const scale = (BAR_W - 64) / longest
  const trimW = sum.endTrimMm * scale
  const kerfW = sum.kerfMm * scale
  const w = bar.stockMm * scale
  const mono = [FONT_FAMILY.mono, FONT_FAMILY.arabic]
  const parts: ReactElement[] = [
    h(Rect, { key: 'stock', x: 0, y: 0, width: w, height: BAR_H, fill: C.soft, stroke: C.line, strokeWidth: 1 }),
    h(Rect, { key: 'trim-a', x: 0, y: 0, width: trimW, height: BAR_H, fill: C.trim }),
  ]
  let x = trimW
  bar.pieces.forEach((piece, i) => {
    const pw = piece.lengthMm * scale
    const cx = x + pw / 2
    const roomy = pw > 46
    parts.push(
      h(Rect, { key: `p${i}`, x, y: 2, width: pw, height: BAR_H - 4, fill: C.piece, stroke: C.ink, strokeWidth: 0.7 }),
      h(
        Text,
        { key: `l${i}`, x: cx, y: pw > 20 ? 11 : 15, textAnchor: 'middle', fill: C.ink, style: { fontFamily: mono, fontWeight: 600, fontSize: roomy ? 8.5 : 7 } },
        String(piece.lengthMm),
      ),
    )
    const label = fitLabel(shortLabel(piece, s), pw)
    if (label && pw > 20) {
      parts.push(
        h(
          Text,
          { key: `t${i}`, x: cx, y: 20.5, textAnchor: 'middle', fill: C.mute, style: { fontFamily: d.family, direction: d.s.dir, fontSize: roomy ? 6.8 : 6 } },
          label,
        ),
      )
    }
    x += pw + kerfW
  })
  parts.push(
    h(Rect, { key: 'offcut', x, y: 2, width: Math.max(bar.offcutMm * scale, 0), height: BAR_H - 4, fill: C.accentSoft, stroke: C.accent, strokeWidth: 0.7, strokeDasharray: '3 2' }),
    h(Rect, { key: 'trim-b', x: w - trimW, y: 0, width: trimW, height: BAR_H, fill: C.trim }),
    h(Text, { key: 'waste', x: w + 6, y: 12, fill: C.accent, style: { fontFamily: mono, fontWeight: 600, fontSize: 8 } }, String(bar.wasteMm)),
    h(Text, { key: 'waste-l', x: w + 6, y: 21, fill: C.accent, style: { fontFamily: d.family, direction: d.s.dir, fontSize: 6.5 } }, s.wasteShort),
    h(Text, { key: 'stock-l', x: w - trimW - 2, y: -2, textAnchor: 'end', fill: C.mute, style: { fontFamily: mono, fontSize: 6 } }, String(bar.stockMm)),
  )
  return h(
    View,
    { key: index, wrap: false, style: { flexDirection: 'row', alignItems: 'center', gap: px(6), marginTop: px(4) } },
    h(Text, { style: { fontFamily: mono, fontSize: px(8.5), color: C.mute, width: px(16), textAlign: 'right' } }, String(index + 1)),
    h(Svg, { width: px(BAR_W), height: px(BAR_H + 8), viewBox: `0 -6 ${BAR_W} ${BAR_H + 8}` }, ...parts),
  )
}

/** "W-01 · sa B L": a window name like "W-01 Living room" keeps its
 * leading code; otherwise the whole name, before the part (D26). */
function shortLabel(piece: BarOptimiserReportPiece, s: PdfStrings): string {
  const [first, ...rest] = piece.windowName.trim().split(/\s+/)
  const windowShort = rest.length && /\d/.test(first) ? first : piece.windowName
  return `${windowShort} · ${s.partShort(piece.member, piece.at)}`
}

/** As much of the label as fits in `widthPx` at ~3.9 px per character. */
function fitLabel(label: string, widthPx: number): string | null {
  const budget = Math.floor((widthPx - 4) / 3.9)
  if (budget < 3) return null
  if (label.length <= budget) return label
  return `${label.slice(0, Math.max(budget - 1, 1))}…`
}

/** "Aluminia" and "n / N" on every page, digits only. */
function footer() {
  const style: Style = { fontFamily: FONT_FAMILY.sans, fontSize: px(7.5), color: C.mute }
  return h(
    View,
    { fixed: true, style: { position: 'absolute', bottom: px(24), left: px(52.9), right: px(52.9), flexDirection: 'row', justifyContent: 'space-between' } },
    h(Text, { style }, 'Aluminia'),
    h(Text, { style, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `${pageNumber} / ${totalPages}` }),
  )
}
