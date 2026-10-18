import type {
  CreateProjectStatusInput,
  ProjectSettings,
  ProjectStatus,
  UpdateProjectSettingsInput,
  UpdateProjectStatusInput,
} from '@repo/types/project-settings'
import { apiFetch } from '@/lib/api-client'

export function getProjectSettings(): Promise<ProjectSettings> {
  return apiFetch<ProjectSettings>('/project-settings')
}

export function updateProjectSettings(input: UpdateProjectSettingsInput): Promise<ProjectSettings> {
  return apiFetch<ProjectSettings>('/project-settings', { method: 'PATCH', body: input })
}

export function listProjectStatuses(): Promise<ProjectStatus[]> {
  return apiFetch<ProjectStatus[]>('/project-statuses')
}

export function createProjectStatus(input: CreateProjectStatusInput): Promise<ProjectStatus> {
  return apiFetch<ProjectStatus>('/project-statuses', { method: 'POST', body: input })
}

export function updateProjectStatus(id: string, input: UpdateProjectStatusInput): Promise<ProjectStatus> {
  return apiFetch<ProjectStatus>(`/project-statuses/${id}`, { method: 'PATCH', body: input })
}

export function deleteProjectStatus(id: string): Promise<void> {
  return apiFetch<void>(`/project-statuses/${id}`, { method: 'DELETE' })
}

export function reorderProjectStatuses(ids: string[]): Promise<ProjectStatus[]> {
  return apiFetch<ProjectStatus[]>('/project-statuses/order', { method: 'PUT', body: { ids } })
}
