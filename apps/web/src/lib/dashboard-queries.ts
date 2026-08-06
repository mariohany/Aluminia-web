import { useQuery } from '@tanstack/react-query'
import * as dashboardApi from '@/lib/dashboard-api'

const dashboardSummaryKey = ['dashboard', 'summary'] as const

export function useDashboardSummaryQuery() {
  return useQuery({ queryKey: dashboardSummaryKey, queryFn: dashboardApi.getDashboardSummary })
}
