import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateProjectStatusInput,
  ProjectStatus,
  UpdateProjectSettingsInput,
  UpdateProjectStatusInput,
} from '@repo/types/project-settings'
import * as api from '@/lib/project-settings-api'

export const projectSettingsKey = ['project-settings'] as const
export const projectStatusesKey = ['project-statuses'] as const

export function useProjectSettingsQuery() {
  return useQuery({ queryKey: projectSettingsKey, queryFn: api.getProjectSettings })
}

export function useUpdateProjectSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProjectSettingsInput) => api.updateProjectSettings(input),
    onSuccess: (settings) => queryClient.setQueryData(projectSettingsKey, settings),
  })
}

/** Every company user reads this: Config's list, and the project panel's
 * status name, colour, step and responsible users. */
export function useProjectStatusesQuery() {
  return useQuery({ queryKey: projectStatusesKey, queryFn: api.listProjectStatuses })
}

function useInvalidateStatuses() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: projectStatusesKey })
}

export function useCreateProjectStatusMutation() {
  const invalidate = useInvalidateStatuses()
  return useMutation({
    mutationFn: (input: CreateProjectStatusInput) => api.createProjectStatus(input),
    onSuccess: () => invalidate(),
  })
}

export function useUpdateProjectStatusMutation() {
  const invalidate = useInvalidateStatuses()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProjectStatusInput }) => api.updateProjectStatus(id, input),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteProjectStatusMutation() {
  const invalidate = useInvalidateStatuses()
  return useMutation({
    mutationFn: (id: string) => api.deleteProjectStatus(id),
    onSettled: () => invalidate(),
  })
}

/** Saves on drop. The list moves at once; a refusal (someone else changed
 * it) puts the old order back and refetches. */
export function useReorderProjectStatusesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderProjectStatuses(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: projectStatusesKey })
      const previous = queryClient.getQueryData<ProjectStatus[]>(projectStatusesKey)
      if (previous) {
        const byId = new Map(previous.map((status) => [status.id, status]))
        queryClient.setQueryData<ProjectStatus[]>(
          projectStatusesKey,
          ids.flatMap((id, index) => {
            const status = byId.get(id)
            return status ? [{ ...status, position: index + 1 }] : []
          }),
        )
      }
      return { previous }
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(projectStatusesKey, context.previous)
    },
    onSuccess: (statuses) => queryClient.setQueryData(projectStatusesKey, statuses),
    onSettled: () => queryClient.invalidateQueries({ queryKey: projectStatusesKey }),
  })
}
