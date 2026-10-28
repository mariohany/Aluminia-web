import { useQuery } from '@tanstack/react-query'
import * as dashboardApi from '@/lib/dashboard-api'
import type { CompaniesPerMonthRange } from '@/lib/dashboard-api'

const dashboardSummaryKey = ['dashboard', 'summary'] as const

export function useDashboardSummaryQuery() {
  return useQuery({ queryKey: dashboardSummaryKey, queryFn: dashboardApi.getDashboardSummary })
}

export function useCompaniesPerMonthQuery(range: CompaniesPerMonthRange) {
  return useQuery({
    queryKey: ['dashboard', 'companies-per-month', range.from ?? null, range.to ?? null],
    queryFn: () => dashboardApi.getCompaniesPerMonth(range),
  })
}

export function useDashboardBillingQuery(enabled: boolean) {
  return useQuery({ queryKey: ['dashboard', 'billing'] as const, queryFn: dashboardApi.getDashboardBilling, enabled })
}
