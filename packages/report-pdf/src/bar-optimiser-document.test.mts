import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { before, describe, it } from 'node:test'
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BarOptimiserReport, BarOptimiserReportBar, ReportLanguage } from '@repo/types/reports'
import { barOptimiserDocument, barPatterns, colourTotals, mixText, patternLetter, squareMetreNumber } from './bar-optimiser-document.mts'
import { registerFonts } from './fonts.mts'
import { stringsFor } from './strings.ts'

// Draws the real bar optimiser PDF (fixture: the "Mario Villa" report cut
// down, four stock lengths) and reads it back with pdf.js
// (docs/browser_pdf_planing.md §9). pdf.js returns each line in reading
// order, so a missing right-to-left setting shows up as a wrongly ordered
// line ("أكتوبر 2026 19").

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), 'utf8')) as BarOptimiserReport
// Saved before docs/bar_waste_area_planing.md: no areas, no mitre ends.
const report = fixture('bar-optimiser-report.json')
// The same report with them.
const areaReport = fixture('bar-optimiser-report-area.json')
const company = { enName: 'Cairo Aluminium Works', arName: 'مصنع القاهرة' }
// A real 1 × 1 PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** One text run as pdf.js returns it (a font change starts a new run). */
interface Line {
  str: string
  x: number
  right: number
  y: number
}
interface Drawn {
  pages: Line[][]
  pageWidth: number
}

async function draw(language: ReportLanguage, logo: string | null = null, from: BarOptimiserReport = report): Promise<Drawn> {
  const buffer = await renderToBuffer(barOptimiserDocument({ language, report: from, company, logo }))
  const pdf = await getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise
  const pages: Line[][] = []
  let pageWidth = 0
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    pageWidth = page.getViewport({ scale: 1 }).width
    const items = (await page.getTextContent()).items.filter(
      (i): i is typeof i & { str: string; width: number; transform: number[] } => 'str' in i && i.str.trim() !== '',
    )
    pages.push(
      items.map((i) => ({ str: i.str.trim(), x: i.transform[4], right: i.transform[4] + i.width, y: i.transform[5] })),
    )
  }
  return { pages, pageWidth }
}

const has = (lines: Line[], text: string) =>
  assert.ok(
    lines.some((l) => l.str === text),
    `expected the line "${text}", got: ${lines.map((l) => l.str).slice(0, 40).join(' | ')}`,
  )

before(() => registerFonts((file) => new URL(`../fonts/${file}`, import.meta.url).pathname))

for (const [language, from, label] of [
  ['ar', report, ''],
  ['en', report, ''],
  ['ar', areaReport, ', areas'],
  ['en', areaReport, ', areas'],
] as const) {
  describe(`bar optimiser PDF (${language}${label})`, () => {
    let drawn: Drawn
    before(async () => {
      drawn = await draw(language, null, from)
    })

    it('keeps every line inside the page margins (bug-119: no cut-off orders)', () => {
      const margin = 14 * (72 / 25.4) - 1
      for (const [i, lines] of drawn.pages.entries()) {
        for (const line of lines) {
          assert.ok(line.x >= margin && line.right <= drawn.pageWidth - margin, `page ${i + 1}: "${line.str}" at ${line.x}–${line.right}`)
        }
      }
    })

    it('prints every stock mix whole, wrapping only after a "+"', () => {
      // The orders table may run onto the next page.
      const page1 = drawn.pages.flat()
      const text = page1.map((l) => l.str).join(' ')
      for (const p of from.summary.profiles) {
        for (const term of p.best ? mixText(p.best.mix).split(' + ') : []) {
          assert.ok(text.includes(term), `${p.profileNo}: "${term}" missing`)
        }
      }
      // A run starting with "+" or "·" must continue text on its own line
      // (the waste % is its own run, in a smaller size), never open one.
      for (const run of page1.filter((l) => /^[+·]/.test(l.str))) {
        const follows = page1.some((l) => l !== run && Math.abs(l.y - run.y) < 3 && Math.abs(l.right - run.x) < 6)
        assert.ok(follows, `a line starts with "${run.str}"`)
      }
    })

    it('numbers its pages "n / N"', () => {
      const n = drawn.pages.length
      assert.ok(n >= 2, 'the cutting plan starts its own page')
      for (const [i, lines] of drawn.pages.entries()) has(lines, `${i + 1} / ${n}`)
    })
  })
}

describe('right to left (Arabic)', () => {
  it('orders lines that mix Arabic and numbers as they are read', async () => {
    const s = stringsFor('ar')
    const page1 = (await draw('ar')).pages[0]
    has(page1, '19 أكتوبر 2026')
    has(page1, s.windowsValue(report.summary.windowCount, report.summary.unitCount))
    has(page1, s.colOnly(7000))
  })
})

describe('the header', () => {
  it('prints a PNG logo instead of the "A" mark', async () => {
    const withLogo = await draw('en', PNG)
    assert.ok(!withLogo.pages[0].some((l) => l.str === 'A'), 'the "A" mark is gone')
    has((await draw('en')).pages[0], 'A')
  })

  it('names the company in the PDF\'s language, English when there is no Arabic name', async () => {
    has((await draw('en')).pages[0], 'Cairo Aluminium Works')
    has((await draw('ar')).pages[0], 'مصنع القاهرة')
  })
})

// docs/bar_waste_area_planing.md §4.
describe('waste as an area', () => {
  for (const language of ['en', 'ar'] as const) {
    it(`prints every waste in m², each bar's too (${language})`, async () => {
      const s = stringsFor(language)
      const { pages } = await draw(language, null, areaReport)
      const all = pages.flat().map((l) => l.str)
      const text = all.join(' ')
      const bar = areaReport.plans.find((p) => p.best?.bars.length)!.best!.bars[0]
      assert.ok(all.includes(squareMetreNumber(bar.wasteMm2!)), 'a bar prints its m²')
      assert.ok(text.includes('m²') && !text.includes('mm²'), 'labelled in m², never mm²')
      assert.ok(all.some((l) => / m²$/.test(l)), 'a total prints m²')
      // Arabic runs split at digits, so look for words.
      assert.ok(text.includes(s.legendCut.split(' ').at(-1)!), 'the legend names the saw cut')
      assert.ok(text.includes(language === 'en' ? 'drawn larger' : 'مرسومة'), 'the legend says the ends are enlarged')
    })
  }

  it('draws an older report as before: waste in mm, no m², no new legend', async () => {
    const s = stringsFor('en')
    const all = (await draw('en')).pages.flat().map((l) => l.str)
    assert.ok(!all.some((l) => l.includes('m²')))
    assert.ok(!all.includes(s.legendCut))
    assert.ok(all.includes(String(Math.round(report.plans.find((p) => p.best?.bars.length)!.best!.bars[0].wasteMm))))
  })
})

describe('patterns: repeated bars drawn once (docs/bar_patterns_planing.md)', () => {
  const s = stringsFor('en')
  const template = areaReport.plans.find((p) => p.best?.bars.length)!.best!.bars[0]
  const piece = template.pieces[0]
  const bar = (stockMm: number, pieces: [number, number?, string?][]): BarOptimiserReportBar => ({
    ...template,
    stockMm,
    pieces: pieces.map(([lengthMm, end = 45, windowName = 'W-01 Living']) => ({ ...piece, lengthMm, endsMm: [end, end], windowName })),
  })

  it('groups bars by stock, lengths and ends, not by window labels (G1)', () => {
    const bars = [
      bar(7000, [[2500], [2500]]),
      bar(7000, [[2500, 45, 'W-02 Kitchen'], [2500]]),
      bar(7000, [[2500, 0], [2500]]), // square end: another cut
      bar(6500, [[2500], [2500]]), // another stock
      bar(7000, [[2500], [2500]]),
    ]
    const patterns = barPatterns(bars, s)
    assert.deepEqual(
      patterns.map((p) => [p.letter, p.count, p.bar.stockMm]),
      [
        ['A', 3, 7000],
        ['B', 1, 7000],
        ['C', 1, 6500],
      ],
    )
    assert.equal(
      patterns.reduce((n, p) => n + p.count, 0),
      bars.length,
      'every bar counted once',
    )
  })

  it('lists where the pieces go, most first (G2)', () => {
    const [a] = barPatterns([bar(7000, [[2500], [2500, 45, 'W-02 Kitchen']]), bar(7000, [[2500], [2500]])], s)
    const part = s.partShort(piece.member, piece.at)
    assert.deepEqual(a.goesTo, [
      { label: `W-01 · ${part}`, count: 3 },
      { label: `W-02 · ${part}`, count: 1 },
    ])
  })

  it('names patterns A … Z, then AA, AB …', () => {
    assert.deepEqual([0, 25, 26, 27, 701, 702].map(patternLetter), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  for (const language of ['en', 'ar'] as const) {
    it(`prints each pattern once with ×N, the Ns adding up to the bars (${language})`, async () => {
      const ls = stringsFor(language)
      const lines = (await draw(language, null, areaReport)).pages.flat()
      const text = lines.map((l) => l.str)
      for (const plan of areaReport.plans.filter((p) => p.best?.bars.length)) {
        for (const pattern of barPatterns(plan.best!.bars, ls)) {
          assert.ok(text.includes(`×${pattern.count}`), `prints ×${pattern.count}`)
        }
      }
      // A pattern's ×N sits left of its bar (in both languages); the goes-to counts sit under it.
      const counts = lines.filter((l) => /^×\d+$/.test(l.str) && l.x < 70)
      const printed = counts.reduce((n, l) => n + Number(l.str.slice(1)), 0)
      const bars = areaReport.plans.reduce((n, p) => n + (p.best?.bars.length ?? 0), 0)
      assert.equal(printed, bars)
      // Arabic runs split at digits, so look for the words.
      assert.ok(text.join(' ').includes(ls.goesTo.replace(/[:\s]+$/, '')), 'prints the goes-to line')
    })
  }

  it('draws a stored-pattern report exactly like the same report listing every bar', async () => {
    // What the API stores from 2026-10-24 on (docs/report_speed_planing.md §5).
    const compact: BarOptimiserReport = structuredClone(areaReport)
    for (const plan of compact.plans) {
      if (!plan.best) continue
      const byCut = new Map<string, BarOptimiserReportBar>()
      for (const bar of plan.best.bars) {
        const key = [bar.stockMm, ...bar.pieces.map((p) => `${p.lengthMm}/${(p.endsMm ?? [0, 0]).join('/')}`)].join(':')
        const stored = byCut.get(key) ?? { ...bar, count: 0, goesTo: [] }
        stored.count! += 1
        for (const { windowName, member, at } of bar.pieces) stored.goesTo!.push({ windowName, member, at, count: 1 })
        byCut.set(key, stored)
      }
      plan.best.bars = [...byCut.values()]
    }
    for (const language of ['en', 'ar'] as const) {
      const text = async (from: BarOptimiserReport) => (await draw(language, null, from)).pages.map((page) => page.map((l) => l.str))
      assert.deepEqual(await text(compact), await text(areaReport))
    }
  })
})

describe('colour pairs (docs/report_colours_planing.md §5)', () => {
  const white = { ref: 'platform:white', code: 'RAL 9016', hex: '#F1F0EA' }
  const grey = { ref: 'company:grey', code: 'RAL 7016', hex: '#383E42' }
  const gone = { ref: 'company:gone', code: null, hex: null }
  const coloured: BarOptimiserReport = structuredClone(areaReport)
  const pairs = [
    { interior: white, exterior: grey },
    { interior: null, exterior: null },
    { interior: gone, exterior: white },
  ]
  coloured.plans.forEach((plan, i) => (plan.colors = pairs[i % pairs.length]))
  coloured.summary.profiles.forEach((p, i) => (p.colors = pairs[i % pairs.length]))

  for (const language of ['en', 'ar'] as const) {
    it(`prints each plan's pair, "no colour" and a gone code as "?" (${language})`, async () => {
      const s = stringsFor(language)
      const { pages, pageWidth } = await draw(language, null, coloured)
      const lines = pages.flat()
      // pdf.js may join "RAL 9016 /" into one run or split "RAL" from
      // its number, so look at the text, not single runs.
      const text = lines.map((l) => l.str).join(' ')
      for (const term of ['9016', '7016', '?', '/', s.noColour]) {
        assert.ok(text.includes(term), `"${term}" missing`)
      }
      // Swatches + codes stay inside the margins too (bug-119).
      const margin = 14 * (72 / 25.4) - 1
      for (const line of lines) {
        assert.ok(line.x >= margin && line.right <= pageWidth - margin, `"${line.str}" at ${line.x}–${line.right}`)
      }
      // Inside before outside in reading order, on every line with both.
      let rows = 0
      for (const page of pages) {
        for (const run of page.filter((l) => l.str.includes('9016'))) {
          const outside = page.find((l) => l.str.includes('7016') && Math.abs(l.y - run.y) < 1.5)
          if (!outside) continue
          rows++
          assert.ok(language === 'en' ? run.x < outside.x : run.x > outside.x, `inside / outside order at y ${run.y}`)
        }
      }
      assert.ok(rows > 0, 'a header prints both sides on one line')
    })
  }

  it('prints no colours for a report made before them', async () => {
    const lines = (await draw('en', null, areaReport)).pages.flat()
    assert.ok(!lines.some((l) => l.str === stringsFor('en').noColour))
    assert.ok(!lines.some((l) => l.str === stringsFor('en').coloursHeading))
    assert.equal(colourTotals(areaReport.summary), null)
  })

  it('sums the bars per colour pair, by code, no colour last', () => {
    const totals = colourTotals(coloured.summary)!
    assert.deepEqual(
      totals.map((t) => [t.colors.interior?.code, t.colors.exterior?.code]),
      [['RAL 9016', 'RAL 7016'], [null, 'RAL 9016'], [undefined, undefined]],
    )
    // Every bar of the order list lands in exactly one colour.
    const bars = coloured.summary.profiles.reduce((n, p) => n + (p.best?.barCount ?? 0), 0)
    assert.equal(totals.reduce((n, t) => n + t.barCount, 0), bars)
    for (const t of totals) {
      assert.equal(Object.values(t.mix).reduce((n, c) => n + c, 0), t.barCount)
    }
    // Two profiles with the same pair add up into one row.
    const twice = structuredClone(coloured.summary)
    twice.profiles.forEach((p) => (p.colors = pairs[0]))
    const [one] = colourTotals(twice)!
    assert.equal(colourTotals(twice)!.length, 1)
    assert.equal(one.barCount, bars)
  })

  for (const language of ['en', 'ar'] as const) {
    it(`prints the bars-per-colour table with its total (${language})`, async () => {
      const s = stringsFor(language)
      // Page 1 is full in this fixture, so the table may start on page 2.
      const lines = (await draw(language, null, coloured)).pages.flat()
      // pdf.js reads Arabic back in presentation forms: check English only.
      if (language === 'en') {
        has(lines, s.coloursHeading)
        has(lines, s.colColour.toUpperCase())
      }
      const bars = coloured.summary.profiles.reduce((n, p) => n + (p.best?.barCount ?? 0), 0)
      assert.ok(lines.some((l) => l.str.trim() === String(bars)), `grand total ${bars}`)
    })
  }
})
