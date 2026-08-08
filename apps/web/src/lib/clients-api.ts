import type {
  ClientDetail,
  ClientSummary,
  ClientWithProjects,
  CreateClientInput,
  UpdateClientInput,
} from '@repo/types/clients'
import { apiFetch } from '@/lib/api-client'

// One request returns the whole tree — clients with their projects
// nested. See docs/projects_planing.md section 3.
export function listClientTree(): Promise<ClientWithProjects[]> {
  return apiFetch<ClientWithProjects[]>('/clients')
}

export function getClient(id: string): Promise<ClientDetail> {
  return apiFetch<ClientDetail>(`/clients/${id}`)
}

export function createClient(input: CreateClientInput): Promise<ClientSummary> {
  return apiFetch<ClientSummary>('/clients', { method: 'POST', body: input })
}

export function updateClient(id: string, input: UpdateClientInput): Promise<ClientSummary> {
  return apiFetch<ClientSummary>(`/clients/${id}`, { method: 'PATCH', body: input })
}

export function deleteClient(id: string, confirmName: string): Promise<void> {
  return apiFetch<void>(`/clients/${id}`, { method: 'DELETE', body: { confirmName } })
}
