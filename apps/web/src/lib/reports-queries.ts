import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CuttingSettingsInput, ReportStatus } from '@repo/types/reports'
import * as reportsApi from '@/lib/reports-api'

export const reportsKey = ['reports'] as const
export const cuttingSettingsKey = [...reportsKey, 'cutting-settings'] as const
export const barOptimiserStatusKey = (projectId: string) => [...reportsKey, 'bar-optimiser', projectId] as const

/** While a solve runs, poll every second (docs/browser_solve_planing.md
 * B5). */
const RUNNING_POLL_MS = 1000

export function useCuttingSettingsQuery() {
  return useQuery({ queryKey: cuttingSettingsKey, queryFn: reportsApi.getCuttingSettings })
}

/** Saving makes every project's report stale (D14), so everything under
 * `['reports']` is refetched. */
export function useSaveCuttingSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CuttingSettingsInput) => reportsApi.saveCuttingSettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(cuttingSettingsKey, saved)
      void queryClient.invalidateQueries({ queryKey: reportsKey })
    },
  })
}

export function useBarOptimiserStatusQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: barOptimiserStatusKey(projectId ?? ''),
    queryFn: () => reportsApi.getBarOptimiserStatus(projectId!),
    enabled: !!projectId,
    refetchInterval: (query) => (isSolving(query.state.data) ? RUNNING_POLL_MS : false),
    // A window edit elsewhere makes the report stale; check on return.
    refetchOnWindowFocus: true,
  })
}

/** Only names changed: refresh them, no solve (P8). */
export function useRefreshBarOptimiserMutation(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => reportsApi.refreshBarOptimiser(projectId),
    onSuccess: (status: ReportStatus) => {
      queryClient.setQueryData(barOptimiserStatusKey(projectId), status)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: barOptimiserStatusKey(projectId) })
    },
  })
}

/** Someone's browser is solving (others watch its progress, B5): keep
 * polling. */
export function isSolving(status: ReportStatus | undefined): boolean {
  return status?.solve?.state === 'solving'
}
