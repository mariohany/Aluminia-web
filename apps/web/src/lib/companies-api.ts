import type {
  CompanyDetail,
  CompanyListItem,
  CompanySummary,
  CreateCompanyInput,
  UpdateCompanyInput,
} from '@repo/types/companies'
import type { UpdateSubscriptionInput } from '@repo/types/subscriptions'
import { apiFetch } from '@/lib/api-client'

export function listCompanies(): Promise<CompanyListItem[]> {
  return apiFetch<CompanyListItem[]>('/admin/companies')
}

export function getCompany(id: string): Promise<CompanyDetail> {
  return apiFetch<CompanyDetail>(`/admin/companies/${id}`)
}

export function createCompany(input: CreateCompanyInput): Promise<CompanySummary> {
  return apiFetch<CompanySummary>('/admin/companies', { method: 'POST', body: input })
}

export function updateCompany(id: string, input: UpdateCompanyInput): Promise<CompanySummary> {
  return apiFetch<CompanySummary>(`/admin/companies/${id}`, { method: 'PATCH', body: input })
}

export function updateSubscription(id: string, input: UpdateSubscriptionInput): Promise<CompanyDetail> {
  return apiFetch<CompanyDetail>(`/admin/companies/${id}/subscription`, { method: 'PATCH', body: input })
}

export function resetFreeProject(id: string): Promise<CompanyDetail> {
  return apiFetch<CompanyDetail>(`/admin/companies/${id}/free-project`, { method: 'DELETE' })
}

export function archiveCompany(id: string): Promise<CompanySummary> {
  return apiFetch<CompanySummary>(`/admin/companies/${id}/archive`, { method: 'POST' })
}

export function reactivateCompany(id: string): Promise<CompanySummary> {
  return apiFetch<CompanySummary>(`/admin/companies/${id}/reactivate`, { method: 'POST' })
}

export function deleteCompany(id: string, confirmName: string): Promise<void> {
  return apiFetch<void>(`/admin/companies/${id}`, { method: 'DELETE', body: { confirmName } })
}
