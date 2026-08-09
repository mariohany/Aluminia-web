import { useInfiniteQuery } from '@tanstack/react-query'
import * as logsApi from '@/lib/logs-api'
import type { LogsDateRange } from '@/lib/logs-api'
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

export function useActivityLogInfiniteQuery(range: LogsDateRange) {
  return useInfiniteQuery({
    queryKey: ['logs', 'activity', 'infinite', range.from, range.to] as const,
    queryFn: ({ pageParam }) => logsApi.listActivityLog(pageParam, CHUNK_SIZE, range),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  })
}

export function useAuditLogInfiniteQuery(range: LogsDateRange) {
  return useInfiniteQuery({
    queryKey: ['logs', 'audit', 'infinite', range.from, range.to] as const,
    queryFn: ({ pageParam }) => logsApi.listAuditLog(pageParam, CHUNK_SIZE, range),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  })
}
