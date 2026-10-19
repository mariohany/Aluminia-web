import type {
  CuttingSettings,
  CuttingSettingsInput,
  ReportLanguage,
  ReportProgressGroup,
  ReportStatus,
  SolveResultInput,
  SolveStart,
  StopSolveInput,
} from '@repo/types/reports'
import { apiFetch } from '@/lib/api-client'

// The Reports section's API (docs/reports_planing.md §7,
// docs/browser_solve_planing.md §7).

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

/** Starts a solve in this browser: the piece lines and the token only it
 * may write with. 409 `solving_elsewhere` / `outdated_client`. */
export function startBarOptimiserSolve(
  projectId: string,
  lang: ReportLanguage,
  optimiserVersion: number,
): Promise<SolveStart> {
  return apiFetch<SolveStart>(`${barOptimiserPath(projectId)}/solve?lang=${lang}`, {
    method: 'POST',
    body: { optimiserVersion },
  })
}

/** Progress, and the heartbeat that keeps the solve alive (B5). */
export function sendSolveProgress(projectId: string, token: string, groups: ReportProgressGroup[]): Promise<void> {
  return apiFetch<void>(`${barOptimiserPath(projectId)}/solve/progress`, {
    method: 'PUT',
    body: { token, groups },
  })
}

/** The finished plans; the API checks them and queues the print. */
export function sendSolveResult(
  projectId: string,
  lang: ReportLanguage,
  result: SolveResultInput,
): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(`${barOptimiserPath(projectId)}/solve/result?lang=${lang}`, {
    method: 'POST',
    body: result,
  })
}

export function stopSolve(projectId: string, lang: ReportLanguage, input: StopSolveInput): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(`${barOptimiserPath(projectId)}/solve/stop?lang=${lang}`, {
    method: 'POST',
    body: input,
  })
}

/** Prints this language from the stored solve (B4, B8). */
export function printBarOptimiser(projectId: string, lang: ReportLanguage): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(`${barOptimiserPath(projectId)}/print?lang=${lang}`, { method: 'POST' })
}

export function getBarOptimiserPdf(projectId: string, lang: ReportLanguage): Promise<Blob> {
  return apiFetch<Blob>(`${barOptimiserPath(projectId)}/pdf?lang=${lang}`, { responseType: 'blob' })
}
