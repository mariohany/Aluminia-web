import { z } from 'zod'
import { PAID_PLAN_KEYS, MAX_PLAN_SEATS, type PlanRef } from './plans.ts'
import { BILLING_CURRENCIES, type BillingCurrency } from './subscriptions.ts'
import type { BillingDocumentKind } from './billing-profile.ts'

// Quotations and invoices (docs/subscriptions_planing.md §3d, §4d, B4–B8,
// B18, B21). A quotation is issued before payment; Mark paid turns it into
// an invoice (a copy, marked paid) and renews the company.

export const QUOTATION_MONTHS = [1, 3, 6, 12] as const
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
 * rebuilds them from these (§4d). `unitPrice` is the whole period's price in
 * the quotation currency, prefilled from the plan and overwritable. */
export const quotationInputSchema = z
  .object({
    planKey: z.enum(PAID_PLAN_KEYS),
    seats: z.number().int().min(1).max(MAX_PLAN_SEATS),
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
  subtotal: number
  discountAmount: number
  vatAmount: number
  total: number
  /** The total in EGP at the frozen rate (B6: cross-company sums). */
  totalEgp: number
}

/** The totals, built the same way in the dialog and the API (§4d): VAT on
 * the subtotal after discount, 2 decimals per line. */
export function documentTotals(q: Pick<QuotationInput, 'unitPrice' | 'discountKind' | 'discountValue' | 'vatRate' | 'fxRate'>): DocumentTotals {
  const subtotal = round2(q.unitPrice)
  const discountAmount =
    q.discountKind === 'percent'
      ? round2((subtotal * (q.discountValue ?? 0)) / 100)
      : q.discountKind === 'amount'
        ? round2(Math.min(q.discountValue ?? 0, subtotal))
        : 0
  const taxable = round2(subtotal - discountAmount)
  const vatAmount = round2((taxable * q.vatRate) / 100)
  const total = round2(taxable + vatAmount)
  return { subtotal, discountAmount, vatAmount, total, totalEgp: round2(total * (q.fxRate ?? 1)) }
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
  seats: number
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
