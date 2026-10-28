import type { CompanyOverview } from '@repo/types/users'
import type { CompanySubscription } from '@repo/types/subscriptions'
import { apiFetch } from '@/lib/api-client'

export function getCompanyOverview(): Promise<CompanyOverview> {
  return apiFetch<CompanyOverview>('/company/me')
}

export function getCompanySubscription(): Promise<CompanySubscription> {
  return apiFetch<CompanySubscription>('/company/subscription')
}

export function pickFreeProject(projectId: string): Promise<CompanySubscription> {
  return apiFetch<CompanySubscription>('/company/subscription/free-project', { method: 'POST', body: { projectId } })
}
