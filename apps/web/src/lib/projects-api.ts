import type {
  CreateProjectInput,
  ProjectDetail,
  UpdateProjectInput,
} from '@repo/types/projects'
import { apiFetch } from '@/lib/api-client'

// No list endpoint: the tree comes from GET /clients with projects
// nested. See docs/projects_planing.md section 2.
export function getProject(id: string): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${id}`)
}

export function createProject(input: CreateProjectInput): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>('/projects', { method: 'POST', body: input })
}

export function updateProject(id: string, input: UpdateProjectInput): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${id}`, { method: 'PATCH', body: input })
}

export function deleteProject(id: string): Promise<void> {
  return apiFetch<void>(`/projects/${id}`, { method: 'DELETE' })
}
