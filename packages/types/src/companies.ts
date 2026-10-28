import { z } from 'zod'
import type { UserRole, UserStatus } from './auth'
import type { PlanRef } from './plans'
import type { BillingCurrency, BillingReason } from './subscriptions'

// Same rationale as UserRole in auth.ts: a const object, not a TS `enum`,
// so it survives erasable-syntax-only TypeScript stripping.
export const CompanyStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const
export type CompanyStatus = (typeof CompanyStatus)[keyof typeof CompanyStatus]

// The platform's ceiling on companies, by design (one schema and one
// connection pool each — see tenant-pool.data-source.ts). Display only
// for now: the admin sidebar's capacity bar. Nothing enforces it yet.
export const PLATFORM_COMPANY_LIMIT = 250

// A new company starts on Free (docs/subscriptions_planing.md B12, B20):
// no plan or seats here; the Billing tab's Edit subscription sets them.
// Both names are required (B20); the printed letterhead names are the
// company profile's own.
export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(255),
  nameAr: z.string().trim().min(1).max(255),
  admin: z.object({
    email: z.email(),
    password: z.string().min(8),
  }),
})
export type CreateCompanyInput = z.infer<typeof createCompanySchema>

// The Overview tab's names. Plan, seats, end date, currency and VAT go
// through `PATCH …/subscription` (@repo/types/subscriptions).
export const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  nameAr: z.string().trim().min(1).max(255).optional(),
})
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>

// Deleting a company requires typing its name back — a plain "are you
// sure?" isn't enough for something that drops a tenant schema. The
// actual "does it match" check happens server-side against the real
// company name (the client doesn't get to assert its own correctness);
// this schema just shapes the request.
export const deleteCompanySchema = z.object({
  confirmName: z.string().min(1),
})
export type DeleteCompanyInput = z.infer<typeof deleteCompanySchema>

export interface CompanySummary {
  id: string
  name: string
  // Null only on companies made before the Arabic name existed.
  nameAr: string | null
  status: CompanyStatus
  plan: PlanRef
  maxUsers: number
  // Null on Free. 23:59:59 Cairo of the end date (B9); the state
  // (`subscriptionState`) is computed from it, never stored.
  endsAt: string | null
  isTrial: boolean
  currency: BillingCurrency
  vatRate: number
  userCount: number
  createdAt: string
}

// The Companies page's rows: a summary plus how many projects the
// company has. `null` for an archived company, which isn't counted (see
// ProjectCountsService). Only the list endpoint returns this; the
// mutation endpoints keep returning a plain CompanySummary.
export interface CompanyListItem extends CompanySummary {
  projectCount: number | null
}

// One row of the append-only billing history (§3c).
export interface BillingRecordSummary {
  id: string
  plan: PlanRef
  maxUsers: number
  endsAt: string | null
  isTrial: boolean
  reason: BillingReason
  notes: string | null
  // Null for the system (a trial ending) or a removed account.
  actorEmail: string | null
  effectiveFrom: string
  createdAt: string
}

export interface CompanyUserSummary {
  id: string
  email: string
  role: UserRole
  status: UserStatus
  // Deactivated by the company's drop to Free (B13); a paid plan brings
  // exactly these back (B14).
  planDeactivated: boolean
  createdAt: string
}

export interface CompanyDetail extends CompanyListItem {
  schemaName: string
  updatedAt: string
  billing: BillingRecordSummary[]
  users: CompanyUserSummary[]
}
