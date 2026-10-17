import type { CompanyProfile, UpdateCompanyProfileInput } from '@repo/types/company-profile'
import { apiFetch } from '@/lib/api-client'

export function getCompanyProfile(): Promise<CompanyProfile> {
  return apiFetch<CompanyProfile>('/company/profile')
}

export function updateCompanyProfile(input: UpdateCompanyProfileInput): Promise<CompanyProfile> {
  return apiFetch<CompanyProfile>('/company/profile', { method: 'PATCH', body: input })
}
