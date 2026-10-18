import type { ProjectStatusColor, ProjectStatusUser } from '@repo/types/project-settings'
import { cn } from '@/lib/utils'
import { STATUS_DOT_CLASS } from '@/lib/project-status-colors'

export function StatusDot({ color, className }: { color: ProjectStatusColor; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[color], className)}
    />
  )
}

/** A status name with its dot, as a pill (the project panel). */
export function StatusChip({ name, color }: { name: string; color: ProjectStatusColor }) {
  return (
    <span className="inline-flex h-6.5 items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-[12.5px] font-semibold text-foreground">
      <StatusDot color={color} />
      {name}
    </span>
  )
}

/** Overlapping initials for a status's responsible users (by email: the
 * app has no user names). */
export function ResponsibleAvatars({ users, max = 4 }: { users: ProjectStatusUser[]; max?: number }) {
  const shown = users.slice(0, max)
  const more = users.length - shown.length
  return (
    <span className="flex items-center ps-1.5">
      {shown.map((user) => (
        <span
          key={user.id}
          title={user.email}
          className="-ms-1.5 flex size-6 items-center justify-center rounded-full border-2 border-card bg-accent text-[10px] font-semibold text-foreground uppercase"
        >
          <span aria-hidden="true">{user.email.slice(0, 2)}</span>
          <span className="sr-only">{user.email}</span>
        </span>
      ))}
      {more > 0 && (
        <span className="-ms-1.5 flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground">
          +{more}
        </span>
      )}
    </span>
  )
}
