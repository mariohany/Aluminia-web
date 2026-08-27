import type {
  CreateWindowInput,
  UpdateWindowInput,
  WindowDetail,
  WindowSummary,
} from '@repo/types/windows'
import { apiFetch } from '@/lib/api-client'

export function listWindows(projectId: string): Promise<WindowSummary[]> {
  const params = new URLSearchParams({ projectId })
  return apiFetch<WindowSummary[]>(`/windows?${params}`)
}

export function getWindow(id: string): Promise<WindowDetail> {
  return apiFetch<WindowDetail>(`/windows/${id}`)
}

export function createWindow(input: CreateWindowInput): Promise<WindowDetail> {
  return apiFetch<WindowDetail>('/windows', { method: 'POST', body: input })
}

export function updateWindow(id: string, input: UpdateWindowInput): Promise<WindowDetail> {
  return apiFetch<WindowDetail>(`/windows/${id}`, { method: 'PATCH', body: input })
}

export function deleteWindow(id: string): Promise<void> {
  return apiFetch<void>(`/windows/${id}`, { method: 'DELETE' })
}
