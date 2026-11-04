import { z } from 'zod'
import { PAID_PLAN_KEYS, MAX_PLAN_SEATS, type PlanRef } from './plans.ts'
import { BILLING_CURRENCIES, addDays, daysBetween, type BillingCurrency } from './subscriptions.ts'
import type { BillingDocumentKind } from './billing-profile.ts'

// Quotations and invoices (docs/subscriptions_planing.md §3d, §4d, B4–B8,
// B18, B21). A quotation is issued before payment; Mark paid turns it into
// an invoice (a copy, marked paid) and renews the company.

export const QUOTATION_MONTHS = [1, 3, 6, 12] as const

/** Payment cycle P11, P30: new (from Free or a trial), renewal (the next
 * period of a paid plan) or upgrade (bigger plan / more seats now, with a
 * credit for the unused days). */
export const QUOTATION_PURPOSES = ['new', 'renewal', 'upgrade'] as const
export type QuotationPurpose = (typeof QUOTATION_PURPOSES)[number]
export type QuotationMonths = (typeof QUOTATION_MONTHS)[number]

/** Valid until = issue day + 14 by default, editable (Q3, Mario 2026-10-28). */
export const QUOTATION_VALID_DAYS = 14

export const PAYMENT_METHODS = ['bank_transfer', 'instapay', 'cash', 'cheque'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const DISCOUNT_KINDS = ['percent', 'amount'] as const
export type DiscountKind = (typeof DISCOUNT_KINDS)[number]

/** Stored statuses. `expired` is never stored: an unpaid quotation past its
 * valid-until day reads as expired and can't be paid (Q3). */
export const DOCUMENT_STATUSES = ['draft', 'sent', 'paid', 'void'] as const
export type StoredDocumentStatus = (typeof DOCUMENT_STATUSES)[number]
export const DOCUMENT_VIEW_STATUSES = ['draft', 'sent', 'expired', 'paid', 'void'] as const
export type DocumentStatus = (typeof DOCUMENT_VIEW_STATUSES)[number]

export function documentStatus(
  stored: StoredDocumentStatus,
  validUntil: string | null,
  today: string,
): DocumentStatus {
  if ((stored === 'draft' || stored === 'sent') && validUntil !== null && validUntil < today) {
    return 'expired'
  }
  return stored
}

const money = z.number().finite().min(0).max(100_000_000)
const isoDate = z.iso.date()

/** The New quotation dialog's step 1 (B18). Totals are never sent: the API
 * rebuilds them from these (§4d). `unitPrice` is the plan's price for the
 * period in the quotation currency, prefilled and overwritable. Seats = the
 * plan's own + `extraSeats`, each extra seat at a hand-typed
 * `extraSeatPrice` for the whole period (P15). An upgrade's dates and its
 * credit are set by the API (P11). */
export const quotationInputSchema = z
  .object({
    purpose: z.enum(QUOTATION_PURPOSES),
    planKey: z.enum(PAID_PLAN_KEYS),
    extraSeats: z.number().int().min(0).max(MAX_PLAN_SEATS),
    extraSeatPrice: z.number().finite().min(0).max(100_000_000),
    months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    startsOn: isoDate,
    endsOn: isoDate,
    currency: z.enum(BILLING_CURRENCIES),
    /** EGP per 1 unit of `currency`; null for EGP. Printed and frozen (B6). */
    fxRate: z.number().positive().max(1_000_000).nullable(),
    unitPrice: money,
    discountKind: z.enum(DISCOUNT_KINDS).nullable(),
    discountValue: money.nullable(),
    vatRate: z.number().min(0).max(100),
    validUntil: isoDate,
    note: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .refine((q) => q.endsOn >= q.startsOn, { path: ['endsOn'], message: 'The end is before the start.' })
  .refine((q) => (q.currency === 'EGP') === (q.fxRate === null), {
    path: ['fxRate'],
    message: 'A rate is needed for any currency but EGP.',
  })
  .refine((q) => (q.discountKind === null) === (q.discountValue === null), {
    path: ['discountValue'],
    message: 'Give both the discount kind and value, or neither.',
  })
  .refine((q) => q.discountKind !== 'percent' || (q.discountValue ?? 0) <= 100, {
    path: ['discountValue'],
    message: 'A percent discount is at most 100.',
  })
  .refine((q) => q.extraSeats > 0 || q.extraSeatPrice === 0, {
    path: ['extraSeatPrice'],
    message: 'No price without extra seats.',
  })
export type QuotationInput = z.infer<typeof quotationInputSchema>

/** Mark paid (B4): every field required; the reference prints on the invoice. */
export const markPaidSchema = z
  .object({
    paidOn: isoDate,
    amountReceived: z.number().positive().max(100_000_000),
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().min(1).max(100),
  })
  .strict()
export type MarkPaidInput = z.infer<typeof markPaidSchema>

/** Void (Mario 2026-10-29): confirmed in a dialog, the reason optional. */
export const voidQuotationSchema = z
  .object({ reason: z.string().trim().max(200).nullable().optional() })
  .strict()
export type VoidQuotationInput = z.infer<typeof voidQuotationSchema>

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface DocumentTotals {
  /** The plan line + the extra-seats line. */
  subtotal: number
  /** extraSeats × extraSeatPrice (P15). */
  extraSeatsAmount: number
  discountAmount: number
  /** The upgrade's credit for unused days (P11), after the discount. */
  creditAmount: number
  vatAmount: number
  total: number
  /** The total in EGP at the frozen rate (B6: cross-company sums). */
  totalEgp: number
}

type TotalsInput = Pick<
  QuotationInput,
  'unitPrice' | 'extraSeats' | 'extraSeatPrice' | 'discountKind' | 'discountValue' | 'vatRate' | 'fxRate'
> & { creditAmount?: number }

/** The totals, built the same way in the dialog and the API (§4d): plan +
 * extra seats, then the discount, then the credit (never below zero), then
 * VAT, 2 decimals per line. */
export function documentTotals(q: TotalsInput): DocumentTotals {
  const extraSeatsAmount = round2(q.extraSeats * q.extraSeatPrice)
  const subtotal = round2(q.unitPrice + extraSeatsAmount)
  const discountAmount =
    q.discountKind === 'percent'
      ? round2((subtotal * (q.discountValue ?? 0)) / 100)
      : q.discountKind === 'amount'
        ? round2(Math.min(q.discountValue ?? 0, subtotal))
        : 0
  const afterDiscount = round2(subtotal - discountAmount)
  const creditAmount = round2(Math.min(q.creditAmount ?? 0, afterDiscount))
  const taxable = round2(afterDiscount - creditAmount)
  const vatAmount = round2((taxable * q.vatRate) / 100)
  const total = round2(taxable + vatAmount)
  return {
    subtotal,
    extraSeatsAmount,
    discountAmount,
    creditAmount,
    vatAmount,
    total,
    totalEgp: round2(total * (q.fxRate ?? 1)),
  }
}

/** A paid invoice as an upgrade's credit sees it. `valueEgp` = what the
 * client paid for its period before any credit and VAT, in EGP. */
export interface CreditSource {
  number: string
  startsOn: string
  endsOn: string
  valueEgp: number
}

/** One printed credit line: the unused days of one paid invoice. */
export interface CreditLine {
  invoiceNumber: string
  daysLeft: number
  days: number
  amountEgp: number
}

/** P11 (Mario 2026-11-05): the unused days of every paid period still
 * running on `today` (today counts as unused), at what was paid for it.
 * `sources` are in issue order: a day two invoices cover (an earlier
 * upgrade over the original period) is credited once, by the later one. */
export function unusedCredit(sources: CreditSource[], today: string): CreditLine[] {
  const running = sources.filter((source) => source.endsOn >= today)
  if (running.length === 0) return []
  const last = running.reduce((max, source) => (source.endsOn > max ? source.endsOn : max), today)
  const counted = new Map<number, number>()
  for (let day = today; day <= last; day = addDays(day, 1)) {
    for (let i = running.length - 1; i >= 0; i--) {
      const source = running[i]!
      if (source.startsOn <= day && day <= source.endsOn) {
        counted.set(i, (counted.get(i) ?? 0) + 1)
        break
      }
    }
  }
  return running
    .map((source, i) => {
      const days = daysBetween(source.startsOn, source.endsOn) + 1
      const daysLeft = counted.get(i) ?? 0
      return { invoiceNumber: source.number, daysLeft, days, amountEgp: round2((source.valueEgp * daysLeft) / days) }
    })
    .filter((line) => line.amountEgp > 0)
}

/** An upgrade's period (P11): a length that runs past the current end
 * starts today and runs in full (`full`); otherwise it keeps the end. */
export function upgradePeriod(today: string, currentEnd: string, months: QuotationMonths) {
  const fullEnd = periodEnd(today, months)
  const full = fullEnd > currentEnd
  return { startsOn: today, endsOn: full ? fullEnd : currentEnd, full }
}

/** Whether an upgrade gets the credit: always, except the same plan kept to
 * the same end (only extra seats are added, P15). */
export function upgradeHasCredit(samePlan: boolean, full: boolean): boolean {
  return !samePlan || full
}

/** The plan's EGP price for a period (B5): 12 months = the annual price,
 * otherwise monthly × months. */
export function planPeriodEgp(plan: { monthlyEgp: number | null; annualEgp: number | null }, months: QuotationMonths): number {
  return months === 12 ? (plan.annualEgp ?? 0) : round2((plan.monthlyEgp ?? 0) * months)
}

/** A YYYY-MM-DD plus whole months, the day clamped to the month's end (Jan 31 + 1 → Feb 28). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10)
}

/** The period's last day: start + months − 1 day (§4d). */
export function periodEnd(startsOn: string, months: number): string {
  const end = new Date(`${addMonths(startsOn, months)}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() - 1)
  return end.toISOString().slice(0, 10)
}

export interface DocumentParty {
  nameEn: string
  nameAr: string | null
  addressEn: string | null
  addressAr: string | null
  taxId: string | null
  commercialRegister: string | null
}

/** The seller as issued (B17): the Billing profile at that moment. */
export interface DocumentSeller extends DocumentParty {
  billingEmail: string
  phone: string | null
  bankAccount: string
  instapay: string | null
  /** A platform file (purpose billing_logo). */
  logoFileId: string | null
}

export interface BillingDocumentSummary {
  id: string
  kind: BillingDocumentKind
  number: string
  /** The invoice's quotation number (printed "From quotation"). */
  quotationNumber: string | null
  seller: DocumentSeller
  buyer: DocumentParty
  status: DocumentStatus
  company: { id: string; name: string; nameAr: string | null }
  /** The invoice's quotation, or the quotation's invoice. */
  quotationId: string | null
  invoiceId: string | null
  plan: PlanRef
  purpose: QuotationPurpose
  /** Plan seats + extra seats. */
  seats: number
  extraSeats: number
  extraSeatPrice: number
  /** The upgrade's credit lines (P11); empty otherwise. */
  credit: CreditLine[]
  months: QuotationMonths
  startsOn: string
  endsOn: string
  currency: BillingCurrency
  fxRate: number | null
  unitPrice: number
  discountKind: DiscountKind | null
  discountValue: number | null
  vatRate: number
  totals: DocumentTotals
  validUntil: string | null
  note: string | null
  paidOn: string | null
  amountReceived: number | null
  paymentMethod: PaymentMethod | null
  paymentReference: string | null
  voidReason: string | null
  createdByEmail: string | null
  createdAt: string
  /** The last email of it ("Emailed 25 Oct · 2 people"); failed sends aside. */
  lastSent: { at: string; to: string[] } | null
}

/** GET /admin/billing/fx?currency=… (B6). `source` says where the rate came
 * from: today's fetch, the last known one (the API was down), or none (type it). */
export interface FxQuote {
  currency: BillingCurrency
  date: string | null
  egpPerUnit: number | null
  source: 'today' | 'last_known' | 'none'
}

/** Billing › Transactions (B21): cursor-paged, newest first. */
export const transactionsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).optional(),
  kind: z.enum(['quotation', 'invoice']).optional(),
  status: z.enum(DOCUMENT_VIEW_STATUSES).optional(),
  companyId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})
export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>

export interface TransactionsPage {
  items: BillingDocumentSummary[]
  nextCursor: string | null
}

/** The KPIs over Transactions, in EGP at each document's frozen rate. */
export interface TransactionsSummary {
  receivedThisMonthEgp: number
  receivedThisYearEgp: number
  unpaidEgp: number
  unpaidCount: number
  draftCount: number
}

/** POST /admin/billing/documents/:id/send (B16, §6b). The PDF is drawn in
 * the browser and sent along; the server only attaches it (Q1). */
export const sendDocumentSchema = z
  .object({
    to: z.array(z.email().max(255)).min(1).max(10),
    subject: z.string().trim().min(1).max(255),
    /** A hidden copy to the sender. */
    copyMe: z.boolean(),
    /** The PDF, base64; ~1.5 MB at most. */
    pdfBase64: z.string().min(8).max(2_000_000),
  })
  .strict()
export type SendDocumentInput = z.infer<typeof sendDocumentSchema>
