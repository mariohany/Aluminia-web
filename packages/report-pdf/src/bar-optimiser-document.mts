import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { Document, Image, Page, Polygon, Rect, Svg, Text, View, pdf, type DocumentProps } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'
import type {
  BarOptimiserReport,
  BarOptimiserReportBar,
  BarOptimiserReportPiece,
  BarOptimiserSummary,
  ReportColor,
  ReportColorPair,
  ReportLanguage,
  ReportPlanTotals,
  StockMix,
} from '@repo/types/reports'
import { FONT_FAMILY } from './fonts.mts'
import { stringsFor, type PdfStrings } from './strings.ts'

// The bar optimiser PDF, drawn in the user's browser by @react-pdf
// (docs/browser_pdf_planing.md; layout from docs/reports_planing.md D19,
// the API's former HTML template): page 1 = members table + order list + bars per colour,
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
      d.text(`${s.membersNote} ${sum.total.wasteKg !== undefined ? s.wasteNoteKg : sum.total.wasteMm2 !== undefined ? s.wasteNoteArea : s.wasteNote}`, { fontSize: px(9), color: C.mute, marginTop: px(6) }),
      heading(d, '02', s.ordersHeading),
      ordersTable(d, s, report),
      sum.approximate ? d.text(s.approximate, { fontSize: px(9), color: C.mute, marginTop: px(6) }) : null,
      ...coloursSection(d, s, sum),
      skippedBox(d, s, report),
      tooLongBox(d, s, report),
    ),
    ...cuttingPlan(d, s, report, page, head),
  )
}

/** A throwaway page with text in every family and weight, drawn when the
 * Reports section opens (docs/report_speed_planing.md §3): @react-pdf
 * fetches and parses a font only when text first uses it, so the first
 * real report would otherwise wait for all of them. */
export async function warmUpPdfBytes(): Promise<ArrayBuffer> {
  const families = [FONT_FAMILY.sans, FONT_FAMILY.mono, FONT_FAMILY.arabic]
  const weights = [400, 600, 700] as const
  const page = h(
    Page,
    { size: 'A6' },
    ...families.flatMap((fontFamily) =>
      weights.map((fontWeight) =>
        h(Text, { key: `${fontFamily}-${fontWeight}`, style: { fontFamily, fontWeight, direction: fontFamily === FONT_FAMILY.arabic ? 'rtl' : 'ltr' } }, fontFamily === FONT_FAMILY.arabic ? 'هالك ٠١٢' : 'Aluminia 0123'),
      ),
    ),
  )
  return (await pdf(h(Document, {}, page)).toBlob()).arrayBuffer()
}

/** The drawn PDF's bytes: what the browser's worker shows, prints and
 * downloads. Fonts must be registered first (`registerFonts`). */
export async function barOptimiserPdfBytes(input: BarOptimiserPdfInput): Promise<ArrayBuffer> {
  return (await pdf(barOptimiserDocument(input)).toBlob()).arrayBuffer()
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
  const mixRow = h(
    View,
    { style: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: d.rtl ? 'flex-start' : 'flex-end', columnGap: px(6) } },
    ...blocks,
  )
  // The least-waste cell also says how much, in kg (m² in reports 6–7),
  // on its own line.
  const amount = best ? wasteAmount(plan) : null
  const area = amount
    ? d.num(`${amount.number} ${amount.unit}`, { fontSize: px(8.5), color: C.accent, textAlign: d.end })
    : null
  return cell(area ? h(View, null, mixRow, area) : mixRow, width, best ? { backgroundColor: C.accentSoft } : {})
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
    // Weighed by kg when the report has weights (docs/report_waste_kg_planing.md),
    // by area in reports 6–7 (docs/bar_waste_area_planing.md §2).
    const sumOf = (key: 'boughtKg' | 'wasteKg' | 'boughtMm2' | 'wasteMm2') =>
      plans.every((p) => p![key] !== undefined) ? plans.reduce((n, p) => n + p![key]!, 0) : undefined
    const [boughtKg, wasteKg, boughtMm2, wasteMm2] = (['boughtKg', 'wasteKg', 'boughtMm2', 'wasteMm2'] as const).map(sumOf)
    const pct = (w: number, b: number) => (b ? (w / b) * 100 : 0)
    return {
      barCount: plans.reduce((n, p) => n + p!.barCount, 0),
      boughtMm: bought,
      wasteMm: waste,
      boughtKg,
      wasteKg,
      boughtMm2,
      wasteMm2,
      wastePct:
        boughtKg !== undefined && wasteKg !== undefined
          ? pct(wasteKg, boughtKg)
          : boughtMm2 !== undefined && wasteMm2 !== undefined
            ? pct(wasteMm2, boughtMm2)
            : pct(waste, bought),
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

/** A plan's colour pair, inside / outside (docs/report_colours_planing.md
 * §5): a swatch + code per side, each part its own block so Arabic can't
 * reorder it (bug-129). Null for reports made before colours split bars. */
function colorPair(d: Dir, s: PdfStrings, colors: ReportColorPair | undefined, size: number) {
  if (!colors) return null
  const { interior, exterior } = colors
  const none = () => d.text(s.noColour, { fontSize: px(size), color: C.mute })
  if (!interior && !exterior) return none()
  const side = (c: ReportColor | null) =>
    c
      ? d.row(
          { gap: px(2.5), alignItems: 'center' },
          h(View, {
            style: {
              width: px(size),
              height: px(size),
              borderRadius: px(1.5),
              borderWidth: px(0.75),
              borderColor: C.mute,
              backgroundColor: c.hex ?? '#FFFFFF',
            },
          }),
          d.num(c.code ?? '?', { fontSize: px(size) }),
        )
      : none()
  return d.row(
    { gap: px(4), alignItems: 'center', flexWrap: 'wrap' },
    side(interior),
    d.num('/', { fontSize: px(size), color: C.mute }),
    side(exterior),
  )
}

function ordersTable(d: Dir, s: PdfStrings, report: BarOptimiserReport) {
  const sum = report.summary
  const lengths = sum.stockLengthsMm
  const W = { profile: 92, member: 96, pieces: 40 }
  const single = singleWidth(W.profile + W.member + W.pieces, 120, lengths.length, 76)
  const rows = sum.profiles.map((p) =>
    tableRow(d, [
      cell(
        h(
          View,
          { style: { gap: px(2) } },
          d.num(p.profileNo ?? '—', { fontWeight: 700, fontSize: px(10), textAlign: d.start }),
          colorPair(d, s, p.colors, 7.5),
        ),
        W.profile,
      ),
      cell(d.text(s.member[p.member], { fontSize: px(10) }), W.member),
      cell(d.num(String(p.pieceCount), { textAlign: d.end, fontSize: px(10) }), W.pieces),
      ...lengths.map((l) => planCell(d, p.single[String(l)] ?? null, single)),
      p.best ? planCell(d, p.best, 'flex', p.best.mix, true) : cell(d.num('—', { textAlign: d.end }), 'flex'),
    ]),
  )
  return h(
    View,
    null,
    headRow(d, [
      th(d, s.colProfile, W.profile),
      th(d, s.colMember, W.member),
      th(d, s.colPieces, W.pieces, true),
      ...lengths.map((l) => th(d, s.colOnly(l), single, true)),
      th(d, s.colOrder, 'flex', true),
    ]),
    ...(rows.length ? rows : [d.text(s.noPieces, { padding: px(6) })]),
  )
}

/** One colour pair's bars across every profile: what to order (or send
 * to the coater) per colour. */
export interface ColourTotal {
  colors: ReportColorPair
  /** Bars per stock length, from each profile's least-waste order. */
  mix: StockMix
  barCount: number
}

/** The order list's bars summed per colour pair (inside + outside
 * together), ordered by code with "no colour" last like the plans.
 * Null for a report made before colours split the bars. */
export function colourTotals(sum: BarOptimiserSummary): ColourTotal[] | null {
  if (!sum.profiles.some((p) => p.colors)) return null
  const byPair = new Map<string, ColourTotal>()
  for (const p of sum.profiles) {
    if (!p.best || !p.colors) continue
    const key = `${p.colors.interior?.ref ?? ''}|${p.colors.exterior?.ref ?? ''}`
    const total = byPair.get(key) ?? { colors: p.colors, mix: {}, barCount: 0 }
    for (const [length, n] of Object.entries(p.best.mix)) total.mix[length] = (total.mix[length] ?? 0) + n
    total.barCount += p.best.barCount
    byPair.set(key, total)
  }
  // No colour sorts after every code, a gone code ("?") just before it.
  const rank = (c: ReportColor | null) => (c ? (c.code ?? '\uFFFE') : '\uFFFF')
  // Plain code-unit order (localeCompare ignores U+FFFE/U+FFFF).
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const order = (a: ColourTotal, b: ColourTotal) =>
    compare(rank(a.colors.interior), rank(b.colors.interior)) ||
    compare(rank(a.colors.exterior), rank(b.colors.exterior))
  return [...byPair.values()].sort(order)
}

/** "03 Bars per colour": one row per colour pair, bars per stock length,
 * and the total row (docs/report_colours_planing.md §5). */
function coloursSection(d: Dir, s: PdfStrings, sum: BarOptimiserSummary): ReactElement[] {
  const totals = colourTotals(sum)
  if (!totals?.length) return []
  const lengths = sum.stockLengthsMm
  const W = { colour: 200, total: 70 }
  const single = singleWidth(W.colour + W.total, 0, lengths.length, 80)
  const count = (n: number, width: number, bold = false) =>
    cell(
      d.num(n ? String(n) : '—', { textAlign: d.end, fontSize: px(10), ...(bold ? { fontWeight: 700 } : {}), ...(n ? {} : { color: C.mute }) }),
      width,
    )
  const all = (l: number) => totals.reduce((n, t) => n + (t.mix[String(l)] ?? 0), 0)
  return [
    heading(d, '03', s.coloursHeading),
    h(
      View,
      null,
      headRow(d, [
        th(d, s.colColour, W.colour),
        ...lengths.map((l) => th(d, String(l), single, true)),
        th(d, s.total, 'flex', true),
      ]),
      ...totals.map((t) =>
        tableRow(d, [
          cell(colorPair(d, s, t.colors, 9)!, W.colour),
          ...lengths.map((l) => count(t.mix[String(l)] ?? 0, single)),
          cell(d.num(String(t.barCount), { textAlign: d.end, fontSize: px(10), fontWeight: 700, color: C.accent }), 'flex', {
            backgroundColor: C.accentSoft,
          }),
        ]),
      ),
      tableRow(
        d,
        [
          cell(d.text(s.total, { fontWeight: 700, fontSize: px(10) }), W.colour),
          ...lengths.map((l) => count(all(l), single, true)),
          cell(
            d.num(String(totals.reduce((n, t) => n + t.barCount, 0)), { textAlign: d.end, fontSize: px(10), fontWeight: 700, color: C.accent }),
            'flex',
            { backgroundColor: C.accentSoft },
          ),
        ],
        true,
        true,
      ),
    ),
  ]
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
        d.num(p.profileNo ?? '—', { fontSize: px(9) }),
        colorPair(d, s, p.colors, 8),
        d.num(`· ${t.lengthMm} mm × ${t.count}`, { fontSize: px(9) }),
        d.text(`· ${t.windowName}`, { fontSize: px(9) }),
      ),
    ),
  )
  if (!items.length) return null
  return box(d, s.tooLongHeading, s.tooLongNote, items)
}

const BAR_W = 640
const BAR_H = 26
/** A mitred end is drawn at least this wide (A1): to scale it'd be ~4. */
const MIN_END = 8

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
        ...(sum.total.wasteKg !== undefined || sum.total.wasteMm2 !== undefined
          ? [legendItem({ backgroundColor: C.accent, width: px(2), marginHorizontal: px(5.5) }, s.legendCut), d.text(s.legendEnds, { fontSize: px(8.5), color: C.mute })]
          : []),
        d.text(s.legendScale, { fontSize: px(8.5), color: C.mute }),
      ),
      ...plans.map((p, index) => {
        const best = p.best!
        const [first, ...rest] = barPatterns(best.bars, s).map((pattern) => barRow(d, s, sum, pattern, longest))
        return h(
          View,
          // a profile repeats once per colour pair: the index keeps keys apart
          { key: `${p.profile}-${index}`, style: { marginTop: px(12) } },
          h(
            View,
            // the profile's header never ends a page without its first pattern
            { wrap: false },
            d.row(
              { gap: px(8), alignItems: 'flex-end', paddingTop: px(6), borderTopWidth: px(1), borderTopColor: C.line },
              d.num(p.profileNo ?? '—', { fontSize: px(11), fontWeight: 700 }),
              d.text(s.member[p.member], { fontSize: px(10) }),
              colorPair(d, s, p.colors, 9),
              h(View, { style: { flex: 1 } }),
              d.row(
                { gap: px(3) },
                d.num(`${mixText(best.mix)} · ${best.wastePct.toFixed(1)}%${wasteSuffix(best)}`, {
                  fontSize: px(9.5),
                  fontWeight: 600,
                  color: C.accent,
                }),
                d.text(s.waste, { fontSize: px(9.5), fontWeight: 600, color: C.accent }),
              ),
            ),
            first,
          ),
          ...rest,
        )
      }),
    ),
  ]
}

/** Bars cut the same way, drawn once (docs/bar_patterns_planing.md). */
export interface BarPattern {
  /** A, B … Z, AA, AB …, per profile. */
  letter: string
  /** How many bars are cut this way. */
  count: number
  /** The first of them: every bar of a pattern has the same stock, pieces and waste. */
  bar: BarOptimiserReportBar
  /** Its pieces' short labels (D26) with how many, most first. */
  goesTo: { label: string; count: number }[]
}

/** A plan's bars grouped by their cut (G1): the same stock and the same
 * pieces in order, each with the same length and end angles. Labels don't
 * split a pattern. In order of each pattern's first bar. */
export function barPatterns(bars: BarOptimiserReportBar[], s: PdfStrings): BarPattern[] {
  const byCut = new Map<string, { bar: BarOptimiserReportBar; count: number; labels: Map<string, number> }>()
  for (const bar of bars) {
    const key = [bar.stockMm, ...bar.pieces.map((p) => `${p.lengthMm}/${(p.endsMm ?? [0, 0]).join('/')}`)].join(':')
    const group = byCut.get(key) ?? { bar, count: 0, labels: new Map<string, number>() }
    // A report from 2026-10-24 on stores each pattern once, with its count
    // and where its pieces go (docs/report_speed_planing.md §5); an older
    // one lists every bar.
    group.count += bar.count ?? 1
    for (const where of bar.goesTo ?? bar.pieces.map((piece) => ({ ...piece, count: 1 }))) {
      const label = shortLabel(where, s)
      group.labels.set(label, (group.labels.get(label) ?? 0) + where.count)
    }
    byCut.set(key, group)
  }
  return [...byCut.values()].map((group, i) => ({
    letter: patternLetter(i),
    count: group.count,
    bar: group.bar,
    goesTo: [...group.labels]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  }))
}

/** 0 → A, 25 → Z, 26 → AA, 27 → AB … */
export function patternLetter(index: number): string {
  let letter = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
  }
  return letter
}

/** One pattern: its letter over "×N", then its bar to scale — trim ·
 * pieces with their kerfs · offcut · trim, left to right in both
 * languages, as the saw cuts it (D19) — lengths only (G2), and under it
 * the windows its pieces go to. */
function barRow(d: Dir, s: PdfStrings, sum: BarOptimiserSummary, pattern: BarPattern, longest: number) {
  const { bar } = pattern
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
  // A report from version 6 also draws what the cuts take (A1, A2): each
  // mitred end as a slant at least MIN_END wide over a waste box, and
  // every saw cut as a line at least 1 wide. Older reports: rectangles.
  const amount = wasteAmount(bar)
  const areas = amount !== null
  bar.pieces.forEach((piece, i) => {
    const pw = piece.lengthMm * scale
    const cx = x + pw / 2
    const roomy = pw > 46
    const [a, b] = (piece.endsMm ?? [0, 0]).map((e) => (e > 0 ? Math.min(Math.max(e * scale, MIN_END), pw / 3) : 0))
    parts.push(
      ...(a || b
        ? [
            h(Rect, { key: `pw${i}`, x, y: 2, width: pw, height: BAR_H - 4, fill: C.accentSoft, stroke: C.accent, strokeWidth: 0.5 }),
            h(Polygon, { key: `p${i}`, points: `${x},2 ${x + pw},2 ${x + pw - b},${BAR_H - 2} ${x + a},${BAR_H - 2}`, fill: C.piece, stroke: C.ink, strokeWidth: 0.7 }),
          ]
        : [h(Rect, { key: `p${i}`, x, y: 2, width: pw, height: BAR_H - 4, fill: C.piece, stroke: C.ink, strokeWidth: 0.7 })]),
      h(
        Text,
        { key: `l${i}`, x: cx, y: 15, textAnchor: 'middle', fill: C.ink, style: { fontFamily: mono, fontWeight: 600, fontSize: roomy ? 8.5 : 7 } },
        String(piece.lengthMm),
      ),
    )
    if (areas) parts.push(h(Rect, { key: `k${i}`, x: x + pw, y: 0, width: Math.max(kerfW, 1), height: BAR_H, fill: C.accent }))
    x += pw + kerfW
  })
  parts.push(
    h(Rect, { key: 'offcut', x, y: 2, width: Math.max(bar.offcutMm * scale, 0), height: BAR_H - 4, fill: C.accentSoft, stroke: C.accent, strokeWidth: 0.7, strokeDasharray: '3 2' }),
    h(Rect, { key: 'trim-b', x: w - trimW, y: 0, width: trimW, height: BAR_H, fill: C.trim }),
    h(
      Text,
      { key: 'waste', x: w + 6, y: 12, fill: C.accent, style: { fontFamily: mono, fontWeight: 600, fontSize: 8 } },
      amount ? amount.number : String(Math.round(bar.wasteMm)),
    ),
    h(
      Text,
      { key: 'waste-l', x: w + 6, y: 21, fill: C.accent, style: { fontFamily: d.family, direction: d.s.dir, fontSize: 6.5 } },
      amount ? { kg: s.wasteKg, ton: s.wasteTon, 'm²': s.wasteArea }[amount.unit] : s.wasteShort,
    ),
    h(Text, { key: 'stock-l', x: w - trimW - 2, y: -2, textAnchor: 'end', fill: C.mute, style: { fontFamily: mono, fontSize: 6 } }, String(bar.stockMm)),
  )
  return h(
    View,
    { key: pattern.letter, wrap: false, style: { flexDirection: 'row', alignItems: 'flex-start', gap: px(6), marginTop: px(6) } },
    h(
      View,
      { style: { width: px(34), alignItems: 'flex-end', paddingTop: px(6) } },
      h(Text, { style: { fontFamily: mono, fontWeight: 700, fontSize: px(10) } }, pattern.letter),
      h(Text, { style: { fontFamily: mono, fontWeight: 600, fontSize: px(8.5), color: C.accent } }, `×${pattern.count}`),
    ),
    h(
      View,
      { style: { width: px(BAR_W) } },
      h(Svg, { width: px(BAR_W), height: px(BAR_H + 8), viewBox: `0 -6 ${BAR_W} ${BAR_H + 8}` }, ...parts),
      // Each "label ×N" its own block, wrapping whole: one long Arabic run
      // reorders the counts into the next label ("×Window-01 ,2").
      d.row(
        { flexWrap: 'wrap', columnGap: px(8), marginTop: px(1) },
        d.text(s.goesTo, { fontSize: px(7.5), color: C.mute }),
        ...pattern.goesTo.map((g) =>
          d.row(
            { gap: px(2) },
            d.text(g.label, { fontSize: px(7.5), color: C.mute }),
            d.num(`×${g.count}`, { fontSize: px(7.5), color: C.mute }),
          ),
        ),
      ),
    ),
  )
}

/** mm² → "0.18" m², every waste in one unit (Mario); a third decimal
 * below 0.1 m², so a small waste doesn't read "0.00". */
export function squareMetreNumber(mm2: number): string {
  const m2 = mm2 / 1e6
  return m2.toFixed(m2 < 0.1 ? 3 : 2)
}

/** kg → "1.84": two decimals, a third below 0.1 kg so a small waste
 * doesn't read "0.00", one from 100 kg. */
export function kgNumber(kg: number): string {
  return kg.toFixed(kg < 0.1 ? 3 : kg < 100 ? 2 : 1)
}

/** kg → tons from 1000 kg (Mario): up to 3 decimals, trailing zeros
 * dropped ("1.25", "2"). */
export function tonNumber(kg: number): string {
  return String(Number((kg / 1000).toFixed(3)))
}

/** A plan's or bar's waste as printed: kg, tons from 1000 kg
 * (docs/report_waste_kg_planing.md), m² in reports 6–7, null before that
 * (the bar prints mm). */
function wasteAmount(x: { wasteKg?: number; wasteMm2?: number }): { number: string; unit: 'kg' | 'ton' | 'm²' } | null {
  if (x.wasteKg !== undefined) {
    return x.wasteKg >= 1000 ? { number: tonNumber(x.wasteKg), unit: 'ton' } : { number: kgNumber(x.wasteKg), unit: 'kg' }
  }
  if (x.wasteMm2 !== undefined) return { number: squareMetreNumber(x.wasteMm2), unit: 'm²' }
  return null
}

/** " · 1.84 kg", or nothing for a report without amounts. */
function wasteSuffix(x: { wasteKg?: number; wasteMm2?: number }): string {
  const amount = wasteAmount(x)
  return amount ? ` · ${amount.number} ${amount.unit}` : ''
}

/** "W-01 · sa B L": a window name like "W-01 Living room" keeps its
 * leading code; otherwise the whole name, before the part (D26). */
function shortLabel(piece: Pick<BarOptimiserReportPiece, 'windowName' | 'member' | 'at'>, s: PdfStrings): string {
  const [first, ...rest] = piece.windowName.trim().split(/\s+/)
  const windowShort = rest.length && /\d/.test(first) ? first : piece.windowName
  return `${windowShort} · ${s.partShort(piece.member, piece.at)}`
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
