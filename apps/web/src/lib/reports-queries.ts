import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CuttingSettingsInput, ReportLanguage, ReportStatus } from '@repo/types/reports'
import * as filesApi from '@/lib/files-api'
import * as reportsApi from '@/lib/reports-api'
import { drawBarOptimiserPdf, logoDataUri } from '@/lib/report-pdf/draw-pdf'

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

/** The snapshot + today's company details (docs/browser_pdf_planing.md
 * §7). Under the status key, so whatever refreshes the status (a solve,
 * a names refresh) refetches it too; refetched on every open, so company
 * changes show at once (P7). */
export function useBarOptimiserReportQuery(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...barOptimiserStatusKey(projectId), 'report'] as const,
    queryFn: () => reportsApi.getBarOptimiserReport(projectId),
    enabled,
  })
}

/** The company logo as a data URI the PDF can embed (a file never
 * changes: a new upload gets a new id). */
function useLogoDataUriQuery(fileId: string | null | undefined) {
  return useQuery({
    queryKey: ['files', fileId, 'data-uri'] as const,
    queryFn: async () => logoDataUri(await filesApi.getFileBlob(fileId!)),
    enabled: !!fileId,
    staleTime: Infinity,
    retry: false,
  })
}

/**
 * The bar optimiser PDF, drawn in this browser (P1, P2) for `lang`, kept
 * for as long as the tab is open (P3). Keyed by what's printed on it, so
 * a new solve, a names refresh or a company change draws it again and
 * nothing else does. A logo that can't be read prints the "A" mark.
 */
export function useBarOptimiserPdf(projectId: string, lang: ReportLanguage, enabled: boolean) {
  const report = useBarOptimiserReportQuery(projectId, enabled)
  const data = report.data
  const logoId = data?.company.logoFileId ?? null
  const logo = useLogoDataUriQuery(logoId)
  const logoReady = !logoId || logo.isSuccess || logo.isError
  const printed = data && {
    generatedAt: data.report.generatedAt,
    project: data.report.project,
    client: data.report.client,
    company: data.company,
  }
  const drawn = useQuery({
    queryKey: [...reportsKey, 'bar-optimiser-pdf', projectId, lang, JSON.stringify(printed ?? null)] as const,
    queryFn: () =>
      drawBarOptimiserPdf({
        language: lang,
        report: data!.report,
        company: { enName: data!.company.enName, arName: data!.company.arName },
        logo: logo.data ?? null,
      }),
    enabled: enabled && !!data && logoReady,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  return {
    pdf: drawn.data,
    /** Fetching the snapshot or drawing it. */
    isDrawing: enabled && !drawn.data && !drawn.isError && !report.isError,
    isError: report.isError || drawn.isError,
    retry: () => void (report.isError ? report.refetch() : drawn.refetch()),
  }
}
