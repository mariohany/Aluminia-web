import type { ActivityLogEntry, AuditLogEntry, PaginatedResult } from '@repo/types/logs'
import { apiFetch } from '@/lib/api-client'

export interface LogsDateRange {
  from?: string
  to?: string
}

function buildQuery(page: number, pageSize: number, range: LogsDateRange): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  return params.toString()
}

export function listActivityLog(
  page: number,
  pageSize: number,
  range: LogsDateRange,
): Promise<PaginatedResult<ActivityLogEntry>> {
  return apiFetch<PaginatedResult<ActivityLogEntry>>(`/admin/logs/activity?${buildQuery(page, pageSize, range)}`)
}

export function listAuditLog(
  page: number,
  pageSize: number,
  range: LogsDateRange,
): Promise<PaginatedResult<AuditLogEntry>> {
  return apiFetch<PaginatedResult<AuditLogEntry>>(`/admin/logs/audit?${buildQuery(page, pageSize, range)}`)
}
