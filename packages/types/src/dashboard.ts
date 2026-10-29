// Mostly read-only, so mostly no Zod schemas here — nothing is parsed
// from a request body for this feature. companiesPerMonthQuerySchema is
// the one exception: query params, unlike the tile summary, actually
// need validating.
//
// Plan distribution and recent activity used to live here — moved to
// logs.ts, now that both are paginated tabs on the standalone Log page
// instead of dashboard tiles.

import { z } from 'zod'

export interface CompanyStatusCounts {
  active: number
  archived: number
}

export interface LiveSessionsSummary {
  count: number
}

// Unfiltered, across every active company's tenant schema. "Filtered by
// company/date/status" is still open — see
// admin_dashboard_planing.md's open question 2.
export interface ProjectsSummary {
  count: number
}

/** Invoices paid in a Cairo calendar month, in EGP at each one's frozen
 * rate (docs/subscriptions_planing.md B22). */
export interface RevenueSummary {
  thisMonthEgp: number
  lastMonthEgp: number
}

/** The counts on the Leads card's billing tabs (B22). */
export interface BillingCounts {
  endingSoon: number
  unpaid: number
  expired: number
}

export interface DashboardSummary {
  companies: CompanyStatusCounts
  liveSessions: LiveSessionsSummary
  projects: ProjectsSummary
  revenue: RevenueSummary
  billing: BillingCounts
}

/** A company in the Ending soon / Expired tabs: a paid plan (no trial). */
export interface DashboardBillingCompany {
  companyId: string
  companyName: string
  planEn: string
  planAr: string
  endDate: string
  /** Negative once expired. */
  daysLeft: number
}

/** A sent, still payable quotation in the Unpaid tab. */
export interface DashboardUnpaidQuotation {
  documentId: string
  number: string
  companyId: string
  companyName: string
  currency: string
  total: number
  validUntil: string | null
}

/** GET /admin/dashboard/billing: the three billing tabs, 50 rows each. */
export interface DashboardBilling {
  endingSoon: DashboardBillingCompany[]
  unpaid: DashboardUnpaidQuotation[]
  expired: DashboardBillingCompany[]
}

// `from`/`to` are calendar dates (YYYY-MM-DD), same convention as
// logs.ts's logsQuerySchema. Unset on either side defaults to the
// current calendar year on the service side — see DashboardService.
export const companiesPerMonthQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})
export type CompaniesPerMonthQuery = z.infer<typeof companiesPerMonthQuerySchema>

// One point per calendar month in the resolved range, zero-filled —
// the chart never has to guess whether a missing month means "no
// signups" or "no data yet". `month` is that month's first day, UTC,
// as an ISO date string (e.g. "2026-01-01").
export interface CompaniesPerMonthPoint {
  month: string
  count: number
}
