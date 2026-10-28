import type { CompaniesPerMonthPoint, DashboardBilling, DashboardSummary } from '@repo/types/dashboard'
import { apiFetch } from '@/lib/api-client'

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/admin/dashboard/summary')
}

export interface CompaniesPerMonthRange {
  from?: string
  to?: string
}

export function getCompaniesPerMonth(range: CompaniesPerMonthRange): Promise<CompaniesPerMonthPoint[]> {
  const params = new URLSearchParams()
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  const qs = params.toString()
  return apiFetch<CompaniesPerMonthPoint[]>(`/admin/dashboard/companies-per-month${qs ? `?${qs}` : ''}`)
}

/** The Leads card's Ending soon / Unpaid quotations / Expired tabs (B22). */
export function getDashboardBilling(): Promise<DashboardBilling> {
  return apiFetch<DashboardBilling>('/admin/dashboard/billing')
}
