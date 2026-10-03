import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import * as logsApi from '@/lib/logs-api'
import type { LogsFilters } from '@/lib/logs-api'
import type { PaginatedResult } from '@repo/types/logs'

// Fetched in chunks and rendered through a virtualizer (see
// virtualized-log-table.tsx) rather than paginated: the admin scrolls
// through the data directly, and the next chunk loads in transparently
// once they near the end of what's already loaded.
const CHUNK_SIZE = 30

function nextPageParam(lastPage: PaginatedResult<unknown>): number | undefined {
  const loaded = lastPage.page * lastPage.pageSize
  return loaded < lastPage.total ? lastPage.page + 1 : undefined
}

export function useActivityLogInfiniteQuery(filters: LogsFilters) {
  return useInfiniteQuery({
    queryKey: ['logs', 'activity', 'infinite', filters.from, filters.to, filters.search] as const,
    queryFn: ({ pageParam }) => logsApi.listActivityLog(pageParam, CHUNK_SIZE, filters),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  })
}

export function useAuditLogInfiniteQuery(filters: LogsFilters) {
  return useInfiniteQuery({
    queryKey: [
      'logs',
      'audit',
      'infinite',
      filters.from,
      filters.to,
      filters.area,
      filters.actorId,
      filters.search,
    ] as const,
    queryFn: ({ pageParam }) => logsApi.listAuditLog(pageParam, CHUNK_SIZE, filters),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  })
}

// The dashboard's "Recent admin activity" card: just the newest few
// audit entries, no date range. Under the same ['logs', 'audit'] prefix
// so invalidating the audit log refreshes it too.
const RECENT_AUDIT_COUNT = 5

export function useRecentAuditQuery() {
  return useQuery({
    queryKey: ['logs', 'audit', 'recent'] as const,
    queryFn: () => logsApi.listAuditLog(1, RECENT_AUDIT_COUNT, {}),
    // Nothing invalidates the audit log after an admin action, so refetch
    // whenever the dashboard mounts instead of trusting the 30s default.
    staleTime: 0,
  })
}
