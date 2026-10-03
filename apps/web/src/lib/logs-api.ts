import type { ActivityLogEntry, AuditArea, AuditLogEntry, PaginatedResult } from '@repo/types/logs'
import { apiFetch } from '@/lib/api-client'

export interface LogsDateRange {
  from?: string
  to?: string
}

/** Date range plus the Logs page's filters (area/actor are audit-only). */
export interface LogsFilters extends LogsDateRange {
  area?: AuditArea
  actorId?: string
  search?: string
}

function buildQuery(page: number, pageSize: number, filters: LogsFilters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  for (const key of ['from', 'to', 'area', 'actorId', 'search'] as const) {
    const value = filters[key]
    if (value) params.set(key, value)
  }
  return params.toString()
}

export function listActivityLog(
  page: number,
  pageSize: number,
  filters: LogsFilters,
): Promise<PaginatedResult<ActivityLogEntry>> {
  return apiFetch<PaginatedResult<ActivityLogEntry>>(`/admin/logs/activity?${buildQuery(page, pageSize, filters)}`)
}

export function listAuditLog(
  page: number,
  pageSize: number,
  filters: LogsFilters,
): Promise<PaginatedResult<AuditLogEntry>> {
  return apiFetch<PaginatedResult<AuditLogEntry>>(`/admin/logs/audit?${buildQuery(page, pageSize, filters)}`)
}
