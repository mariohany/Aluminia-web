import type { PlanSummary, UpdatePlansInput } from '@repo/types/plans'
import { apiFetch } from '@/lib/api-client'

export function listPlans(): Promise<PlanSummary[]> {
  return apiFetch<PlanSummary[]>('/admin/plans')
}

export function updatePlans(input: UpdatePlansInput): Promise<PlanSummary[]> {
  return apiFetch<PlanSummary[]>('/admin/plans', { method: 'PUT', body: input })
}
