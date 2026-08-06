import type { DashboardSummary } from '@repo/types/dashboard'
import { apiFetch } from '@/lib/api-client'

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/admin/dashboard/summary')
}
