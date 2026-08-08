import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateProjectInput, UpdateProjectInput } from '@repo/types/projects'
import * as projectsApi from '@/lib/projects-api'
import { clientTreeKey } from '@/lib/clients-queries'

export const projectKey = (id: string) => ['projects', id] as const

export function useProjectQuery(id: string | undefined) {
  return useQuery({
    queryKey: projectKey(id ?? ''),
    queryFn: () => projectsApi.getProject(id!),
    enabled: !!id,
  })
}

// Every project mutation invalidates the TREE as well as the project:
// creating, renaming, or deleting a project changes what the navigation
// panel shows, and the tree is the only place a project's name is
// listed. Forgetting this is how a rename appears to do nothing.
export function useCreateProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) => projectsApi.createProject(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientTreeKey })
    },
  })
}

export function useUpdateProjectMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => projectsApi.updateProject(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientTreeKey })
      void queryClient.invalidateQueries({ queryKey: projectKey(id) })
    },
  })
}

export function useDeleteProjectMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => projectsApi.deleteProject(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientTreeKey })
    },
  })
}
