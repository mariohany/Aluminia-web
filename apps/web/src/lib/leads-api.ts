import type { DeleteLeadsResponse, LeadSummary } from '@repo/types/leads'
import { apiFetch } from '@/lib/api-client'

export function listLeads(): Promise<LeadSummary[]> {
  return apiFetch<LeadSummary[]>('/admin/leads')
}

export function markLeadContacted(id: string): Promise<LeadSummary> {
  return apiFetch<LeadSummary>(`/admin/leads/${id}/contacted`, { method: 'POST' })
}

export function deleteLead(id: string): Promise<void> {
  return apiFetch<void>(`/admin/leads/${id}`, { method: 'DELETE' })
}

export function deleteLeads(ids: string[]): Promise<DeleteLeadsResponse> {
  return apiFetch<DeleteLeadsResponse>('/admin/leads', { method: 'DELETE', body: { ids } })
}
