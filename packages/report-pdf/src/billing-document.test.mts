import { strict as assert } from 'node:assert'
import { before, describe, it } from 'node:test'
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { amount, billingDocument, day } from './billing-document.mts'
import { registerFonts } from './fonts.mts'

// Draws a quotation and its invoice (docs/subscriptions_planing.md §5) and
// reads them back with pdf.js, which returns each line in reading order:
// a missing right-to-left setting shows up as a wrongly ordered Arabic line.
// pdf.js splits some Arabic ligatures when extracting (لإ, ضر, بر), so the
// Arabic checked here is words without them.

const quotation: BillingDocumentSummary = {
  id: 'q1',
  kind: 'quotation',
  number: 'QUO-2026-0042',
  quotationNumber: null,
  status: 'sent',
  seller: {
    nameEn: 'Aluminia Software LLC',
    nameAr: 'ألومينيا للبرمجيات',
    addressEn: '12 Tahrir St, Cairo',
    addressAr: '12 شارع التحرير، القاهرة',
    taxId: '512-884-901',
    commercialRegister: '184522',
    billingEmail: 'billing@aluminia.app',
    phone: null,
    bankAccount: 'CIB · EG38 0019 0005 0000 0000 2631 8000 2',
    instapay: 'aluminia@instapay',
    logoFileId: null,
  },
  buyer: {
    nameEn: 'Gulf Facades',
    nameAr: 'واجهات الخليج',
    addressEn: 'Riyadh, KSA',
    addressAr: null,
    taxId: '300-111',
    commercialRegister: null,
  },
  company: { id: 'c1', name: 'Gulf Facades', nameAr: 'واجهات الخليج' },
  quotationId: null,
  invoiceId: null,
  plan: { id: 'p1', key: 'pro', nameEn: 'Pro', nameAr: 'احترافي' },
  seats: 5,
  months: 12,
  startsOn: '2027-01-17',
  endsOn: '2028-01-16',
  currency: 'SAR',
  fxRate: 12.5,
  unitPrice: 5400,
  discountKind: 'percent',
  discountValue: 10,
  vatRate: 15,
  totals: { subtotal: 5400, discountAmount: 540, vatAmount: 729, total: 5589, totalEgp: 69862.5 },
  validUntil: '2026-11-08',
  note: 'Annual renewal.',
  paidOn: null,
  amountReceived: null,
  paymentMethod: null,
  paymentReference: null,
  createdByEmail: null,
  createdAt: '2026-10-25T09:00:00.000Z',
}

const invoice: BillingDocumentSummary = {
  ...quotation,
  id: 'i1',
  kind: 'invoice',
  number: 'INV-2026-0043',
  quotationNumber: 'QUO-2026-0042',
  status: 'paid',
  quotationId: 'q1',
  validUntil: null,
  paidOn: '2026-10-27',
  amountReceived: 5589,
  paymentMethod: 'bank_transfer',
  paymentReference: 'SNB-55120931',
  createdAt: '2026-10-27T10:00:00.000Z',
}

async function linesOf(doc: BillingDocumentSummary): Promise<{ lines: string[]; pages: number }> {
  const buffer = await renderToBuffer(billingDocument({ document: doc, logo: null }))
  const pdf = await getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise
  const lines: string[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const items = (await (await pdf.getPage(n)).getTextContent()).items
    for (const i of items) if ('str' in i && i.str.trim()) lines.push(i.str.trim())
  }
  return { lines, pages: pdf.numPages }
}

const has = (lines: string[], text: string) =>
  assert.ok(lines.includes(text), `expected "${text}", got: ${lines.slice(0, 60).join(' | ')}`)

before(() => registerFonts((file) => new URL(`../fonts/${file}`, import.meta.url).pathname))

describe('billing PDF helpers', () => {
  it('formats amounts and days', () => {
    assert.equal(amount(69862.5), '69,862.50')
    assert.deepEqual(day('2027-01-17'), ['17 Jan 2027', '17 يناير 2027'])
  })
})

describe('quotation PDF', () => {
  let drawn: { lines: string[]; pages: number }
  before(async () => {
    drawn = await linesOf(quotation)
  })

  it('is one page with both titles and the number', () => {
    assert.equal(drawn.pages, 1)
    has(drawn.lines, 'Quotation')
    has(drawn.lines, 'عرض سعر')
    has(drawn.lines, 'QUO-2026-0042')
  })

  it('prints the totals, the discount and the frozen rate', () => {
    has(drawn.lines, '5,400.00')
    has(drawn.lines, '-540.00')
    has(drawn.lines, '729.00')
    has(drawn.lines, '5,589.00')
    has(drawn.lines, 'Converted from EGP at 1 SAR = 12.5 EGP')
  })

  it('says how to pay and prints no PAID stamp', () => {
    has(drawn.lines, quotation.seller.bankAccount)
    has(drawn.lines, 'Please quote QUO-2026-0042 in the transfer.')
    assert.ok(!drawn.lines.includes('PAID'))
  })

  it('keeps the Arabic in reading order, numbers apart', () => {
    has(drawn.lines, 'واجهات الخليج')
    has(drawn.lines, '25 أكتوبر 2026')
    has(drawn.lines, 'محوّل من الجنيه: 1 ريال = 12.5 جنيه')
    has(drawn.lines, 'خصم')
  })
})

describe('invoice PDF', () => {
  let drawn: { lines: string[]; pages: number }
  before(async () => {
    drawn = await linesOf(invoice)
  })

  it('is a paid tax invoice from its quotation', () => {
    assert.equal(drawn.pages, 1)
    has(drawn.lines, 'Tax invoice')
    has(drawn.lines, 'مدفوعة')
    has(drawn.lines, 'PAID')
    has(drawn.lines, 'QUO-2026-0042')
  })

  it('prints the payment and the subscription it bought', () => {
    has(drawn.lines, 'Bank transfer · ref SNB-55120931 · SAR 5,589.00')
    has(drawn.lines, 'Pro · 5 seats · active until 16 Jan 2028, 23:59 Cairo')
  })
})
