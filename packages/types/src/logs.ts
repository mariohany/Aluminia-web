import { z } from 'zod'

// Page-based, not cursor-based: both logs are ordered by a single
// monotonic timestamp column with no concurrent-insert-at-the-boundary
// concern worth cursor complexity for an admin-only, low-traffic view.
// `from`/`to` are calendar dates (YYYY-MM-DD, matching an <input type="date">),
// inclusive on both ends — the service widens them to day boundaries.
export const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})
export type LogsQuery = z.infer<typeof logsQuerySchema>

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// Same billing-history data that used to back the dashboard's "Recent
// activity" tile — moved here now that it lives on its own paginated
// Log page instead.
export interface ActivityLogEntry {
  id: string
  companyId: string
  companyName: string
  plan: string
  maxUsers: number
  notes: string | null
  effectiveFrom: string
}

// Mirrors AdminAuditLog (apps/api/src/database/control-plane/entities) —
// every irreversible/cross-company admin action, actor included.
export interface AuditLogEntry {
  id: string
  actorUserId: string
  actorEmail: string | null
  action: string
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}
