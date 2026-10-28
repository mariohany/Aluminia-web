import { z } from 'zod'

// Billing › Billing profile (docs/subscriptions_planing.md B17, §3e, board
// bill-seller-a): the platform's own business, printed as the seller on
// every quotation and invoice, plus where the next numbers start.

export const BILLING_PROFILE_LIMITS = {
  name: 255,
  address: 500,
  registration: 60,
  email: 255,
  phone: 40,
  bank: 255,
  instapay: 100,
} as const

export const BILLING_DOCUMENT_KINDS = ['quotation', 'invoice'] as const
export type BillingDocumentKind = (typeof BILLING_DOCUMENT_KINDS)[number]

const NUMBER_PREFIX: Record<BillingDocumentKind, string> = {
  quotation: 'QUO',
  invoice: 'INV',
}

/** QUO-2026-0043 / INV-2026-0019 (B17): per year, 4 digits or more. */
export function documentNumber(kind: BillingDocumentKind, year: number, n: number): string {
  return `${NUMBER_PREFIX[kind]}-${year}-${String(n).padStart(4, '0')}`
}

const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable()

/** PUT /admin/billing-profile: the whole form, one Save. Blank optional
 * fields arrive as null (the form's `optionalTextField`). */
export const updateBillingProfileSchema = z
  .object({
    legalNameEn: text(BILLING_PROFILE_LIMITS.name),
    legalNameAr: text(BILLING_PROFILE_LIMITS.name),
    addressEn: text(BILLING_PROFILE_LIMITS.address),
    addressAr: text(BILLING_PROFILE_LIMITS.address),
    taxId: text(BILLING_PROFILE_LIMITS.registration),
    commercialRegister: text(BILLING_PROFILE_LIMITS.registration),
    billingEmail: z.email().max(BILLING_PROFILE_LIMITS.email),
    phone: optionalText(BILLING_PROFILE_LIMITS.phone),
    bankAccount: text(BILLING_PROFILE_LIMITS.bank),
    instapay: optionalText(BILLING_PROFILE_LIMITS.instapay),
    /** An id from `POST /files` (purpose `billing_logo`); null = none. */
    logoFileId: z.uuid().nullable(),
    /** This year's next numbers; they can only go up (B17: no gaps, never reused). */
    nextQuotation: z.number().int().min(1).max(999_999),
    nextInvoice: z.number().int().min(1).max(999_999),
  })
  .strict()
export type UpdateBillingProfileInput = z.infer<typeof updateBillingProfileSchema>

export interface BillingNumbering {
  /** The Cairo year the numbers below belong to. */
  year: number
  nextQuotation: number
  nextInvoice: number
}

export interface BillingProfile {
  /** Null until the first save: no quotation can be issued before. */
  details: Omit<UpdateBillingProfileInput, 'nextQuotation' | 'nextInvoice'> | null
  numbering: BillingNumbering
  updatedAt: string | null
}
