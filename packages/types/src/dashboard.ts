// All read-only, so no Zod schemas here — nothing is ever parsed from a
// request body for this feature yet. Add one if a filter/query-param
// input shows up later (see admin_dashboard_planing.md's open question 2).
//
// Plan distribution and recent activity used to live here — moved to
// logs.ts, now that both are paginated tabs on the standalone Log page
// instead of dashboard tiles.

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

export interface DashboardSummary {
  companies: CompanyStatusCounts
  liveSessions: LiveSessionsSummary
  projects: ProjectsSummary
}
