import type { CompanyOverview } from '@repo/types/users'
import { apiFetch } from '@/lib/api-client'

export function getCompanyOverview(): Promise<CompanyOverview> {
  return apiFetch<CompanyOverview>('/company/me')
}
