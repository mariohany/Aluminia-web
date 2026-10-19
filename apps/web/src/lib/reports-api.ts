import type {
  BarOptimiserReportResponse,
  CuttingSettings,
  CuttingSettingsInput,
  ReportProgressGroup,
  ReportStatus,
  SolveResultInput,
  SolveStart,
  StopSolveInput,
} from '@repo/types/reports'
import { apiFetch } from '@/lib/api-client'

// The Reports section's API (docs/reports_planing.md §7,
// docs/browser_solve_planing.md §7, docs/browser_pdf_planing.md §7).

export function getCuttingSettings(): Promise<CuttingSettings> {
  return apiFetch<CuttingSettings>('/reports/cutting-settings')
}

export function saveCuttingSettings(input: CuttingSettingsInput): Promise<CuttingSettings> {
  return apiFetch<CuttingSettings>('/reports/cutting-settings', { method: 'PUT', body: input })
}

const barOptimiserPath = (projectId: string) => `/projects/${projectId}/reports/bar-optimiser`

export function getBarOptimiserStatus(projectId: string): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(barOptimiserPath(projectId))
}

/** The snapshot to draw the PDF from, with today's company details
 * (docs/browser_pdf_planing.md §7). 404 before the first Generate. */
export function getBarOptimiserReport(projectId: string): Promise<BarOptimiserReportResponse> {
  return apiFetch<BarOptimiserReportResponse>(`${barOptimiserPath(projectId)}/report`)
}

/** Only the project or client was renamed: refresh the names, no solve
 * (P8). 409 `no_solve` when the plan itself is out of date. */
export function refreshBarOptimiser(projectId: string): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(`${barOptimiserPath(projectId)}/refresh`, { method: 'POST' })
}

/** Starts a solve in this browser: the piece lines and the token only it
 * may write with. 409 `solving_elsewhere` / `outdated_client`. */
export function startBarOptimiserSolve(projectId: string, optimiserVersion: number): Promise<SolveStart> {
  return apiFetch<SolveStart>(`${barOptimiserPath(projectId)}/solve`, {
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

/** The finished plans; the API checks them and saves the report. */
export function sendSolveResult(projectId: string, result: SolveResultInput): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(`${barOptimiserPath(projectId)}/solve/result`, {
    method: 'POST',
    body: result,
  })
}

export function stopSolve(projectId: string, input: StopSolveInput): Promise<ReportStatus> {
  return apiFetch<ReportStatus>(`${barOptimiserPath(projectId)}/solve/stop`, {
    method: 'POST',
    body: input,
  })
}
