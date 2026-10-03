import { TONE_CLASS, type Described } from '@/lib/audit-describe'
import { cn } from '@/lib/utils'

/** The small coloured icon tile in front of an audit sentence. */
export function AuditIcon({ described, className }: { described: Described; className?: string }) {
  const { icon: Icon, tone } = described
  return (
    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', TONE_CLASS[tone], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  )
}
