import type {
  CuttingSettings,
  CuttingSettingsInput,
  ReportLanguage,
  ReportStatus,
} from '@repo/types/reports'
import { apiFetch } from '@/lib/api-client'

// The Reports section's API (docs/reports_planing.md §7).

export function getCuttingSettings(): Promise<CuttingSettings> {
  return apiFetch<CuttingSettings>('/reports/cutting-settings')
}

export function saveCuttingSettings(input: CuttingSettingsInput): Promise<CuttingSettings> {
  return apiFetch<CuttingSettings>('/reports/cutting-settings', { method: 'PUT', body: input })
}

const barOptimiserPath = (projectId: string) => `/projects/${projectId}/reports/bar-optimiser`

export function getBarOptimiserStatus(projectId: string, lang: ReportLanguage): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(`${barOptimiserPath(projectId)}?lang=${lang}`)
}

/** Starts the background run (D22); answers at once with the status. */
export function generateBarOptimiser(projectId: string, lang: ReportLanguage): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(`${barOptimiserPath(projectId)}/generate?lang=${lang}`, { method: 'POST' })
}

export function getBarOptimiserPdf(projectId: string, lang: ReportLanguage): Promise<Blob> {
  return apiFetch<Blob>(`${barOptimiserPath(projectId)}/pdf?lang=${lang}`, { responseType: 'blob' })
}
