import type { CreateUserInput, UpdateUserInput, UserSummary } from '@repo/types/users'
import { apiFetch } from '@/lib/api-client'

export function listUsers(): Promise<UserSummary[]> {
  return apiFetch<UserSummary[]>('/admin/users')
}

export function createUser(input: CreateUserInput): Promise<UserSummary> {
  return apiFetch<UserSummary>('/admin/users', { method: 'POST', body: input })
}

export function updateUser(id: string, input: UpdateUserInput): Promise<UserSummary> {
  return apiFetch<UserSummary>(`/admin/users/${id}`, { method: 'PATCH', body: input })
}

export function deactivateUser(id: string): Promise<UserSummary> {
  return apiFetch<UserSummary>(`/admin/users/${id}/deactivate`, { method: 'POST' })
}

export function reactivateUser(id: string): Promise<UserSummary> {
  return apiFetch<UserSummary>(`/admin/users/${id}/reactivate`, { method: 'POST' })
}

export function resetUserPassword(id: string, password: string): Promise<void> {
  return apiFetch<void>(`/admin/users/${id}/reset-password`, { method: 'POST', body: { password } })
}

export function endUserSession(id: string): Promise<void> {
  return apiFetch<void>(`/admin/users/${id}/end-session`, { method: 'POST' })
}

export function deleteUser(id: string, confirmEmail: string): Promise<void> {
  return apiFetch<void>(`/admin/users/${id}`, { method: 'DELETE', body: { confirmEmail } })
}
