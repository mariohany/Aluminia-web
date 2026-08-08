// All read-only, so no Zod schemas here — nothing is ever parsed from a
// request body for this feature yet. Add one if a filter/query-param
// input shows up later (see admin_dashboard_planing.md's open question 2).

export interface CompanyStatusCounts {
  active: number
  archived: number
}

export interface PlanDistributionEntry {
  plan: string
  count: number
}

// Sourced straight from `billing`, which is already append-only history
// (see BillingRecordSummary in companies.ts) — a company's first billing
// row *is* its "company created" event, so this doesn't need a separate
// activity type/kind field. `notes` already reads as the human-facing
// description ("Initial plan set at provisioning." vs "Updated by super
// admin.").
export interface RecentActivityEntry {
  id: string
  companyId: string
  companyName: string
  plan: string
  maxUsers: number
  notes: string | null
  effectiveFrom: string
}

export interface LiveSessionsSummary {
  count: number
}

// Total, not "since last visit" — there's no per-admin read-state to
// track yet, and total is still a meaningful number this early. Revisit
// if the leads list gets built and "new" needs a real definition.
export interface IncomingLeadsSummary {
  count: number
}

// Unfiltered, across every active company's tenant schema. "Filtered by
// company/date/status" is still open — see
// admin_dashboard_planing.md's open question 2.
export interface ProjectsSummary {
  count: number
}

export interface DashboardSummary {
  companies: CompanyStatusCounts
  planDistribution: PlanDistributionEntry[]
  recentActivity: RecentActivityEntry[]
  liveSessions: LiveSessionsSummary
  incomingLeads: IncomingLeadsSummary
  projects: ProjectsSummary
}
