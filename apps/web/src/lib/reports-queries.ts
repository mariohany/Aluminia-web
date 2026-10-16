import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CuttingSettingsInput, ReportLanguage, ReportStatus } from '@repo/types/reports'
import * as reportsApi from '@/lib/reports-api'

export const reportsKey = ['reports'] as const
export const cuttingSettingsKey = [...reportsKey, 'cutting-settings'] as const
export const barOptimiserStatusKey = (projectId: string, lang: ReportLanguage) =>
  [...reportsKey, 'bar-optimiser', projectId, lang] as const

/** While a job waits or runs, poll it every second (D22,
 * docs/report_queue_planing.md C4). */
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

export function useBarOptimiserStatusQuery(projectId: string | undefined, lang: ReportLanguage) {
  return useQuery({
    queryKey: barOptimiserStatusKey(projectId ?? '', lang),
    queryFn: () => reportsApi.getBarOptimiserStatus(projectId!, lang),
    enabled: !!projectId,
    refetchInterval: (query) => (isJobActive(query.state.data) ? RUNNING_POLL_MS : false),
    // A window edit elsewhere makes the report stale; check on return.
    refetchOnWindowFocus: true,
  })
}

export function useGenerateBarOptimiserMutation(projectId: string, lang: ReportLanguage) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => reportsApi.generateBarOptimiser(projectId, lang),
    onSuccess: (status: ReportStatus) => {
      queryClient.setQueryData(barOptimiserStatusKey(projectId, lang), status)
    },
  })
}

export function useCancelBarOptimiserMutation(projectId: string, lang: ReportLanguage) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => reportsApi.cancelBarOptimiser(projectId, lang),
    onSuccess: (status: ReportStatus) => {
      queryClient.setQueryData(barOptimiserStatusKey(projectId, lang), status)
    },
    // A 409 means it started meanwhile: show what it's doing now.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: barOptimiserStatusKey(projectId, lang) })
    },
  })
}

/** A job is waiting for a slot or running. */
export function isJobActive(status: ReportStatus | undefined): boolean {
  return status?.job?.state === 'queued' || status?.job?.state === 'running'
}

/** The cached PDF. Keyed by when it was generated, so a new run fetches
 * the new file and an unchanged one is never downloaded twice. */
export function useBarOptimiserPdfQuery(
  projectId: string | undefined,
  lang: ReportLanguage,
  generatedAt: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...reportsKey, 'bar-optimiser-pdf', projectId ?? '', lang, generatedAt ?? ''] as const,
    queryFn: () => reportsApi.getBarOptimiserPdf(projectId!, lang),
    enabled: !!projectId && !!generatedAt && enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })
}
