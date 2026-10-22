import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { before, describe, it } from 'node:test'
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BarOptimiserReport, ReportLanguage } from '@repo/types/reports'
import { barOptimiserDocument, mixText, squareMetreNumber } from './bar-optimiser-document.mts'
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
