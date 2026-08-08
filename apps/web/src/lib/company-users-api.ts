import type { CreateCompanyUserInput, UserSummary } from '@repo/types/users'
import { apiFetch } from '@/lib/api-client'

// Mirrors users-api.ts, scoped to the caller's own company. No update()
// — CompanyUsersController has no PATCH route at all: a company admin
// cannot change a colleague's role or company, because there is no
// other role or company for them to move to on this surface.
export function listCompanyUsers(): Promise<UserSummary[]> {
  return apiFetch<UserSummary[]>('/company/users')
}

export function createCompanyUser(input: CreateCompanyUserInput): Promise<UserSummary> {
  return apiFetch<UserSummary>('/company/users', { method: 'POST', body: input })
}

export function deactivateCompanyUser(id: string): Promise<UserSummary> {
  return apiFetch<UserSummary>(`/company/users/${id}/deactivate`, { method: 'POST' })
}

export function reactivateCompanyUser(id: string): Promise<UserSummary> {
  return apiFetch<UserSummary>(`/company/users/${id}/reactivate`, { method: 'POST' })
}

export function resetCompanyUserPassword(id: string, password: string): Promise<void> {
  return apiFetch<void>(`/company/users/${id}/reset-password`, { method: 'POST', body: { password } })
}

export function deleteCompanyUser(id: string, confirmEmail: string): Promise<void> {
  return apiFetch<void>(`/company/users/${id}`, { method: 'DELETE', body: { confirmEmail } })
}
