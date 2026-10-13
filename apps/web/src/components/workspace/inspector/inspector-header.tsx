import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, CircleAlert, MoreHorizontal } from 'lucide-react'
import type { TranslatedIssue } from '@/lib/window-weight'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface InspectorAction {
  label: string
  /** `undefined` shows the item disabled, with `disabledReason` as its tooltip. */
  onSelect?: () => void
  disabledReason?: string
  destructive?: boolean
}

/**
 * The inspector's header card — docs/inspector_redesign_planing.md §1:
 * a small picture of what's selected, the crumb (`Window › Panel 1`),
 * the title, status chips, and a ⋯ menu that holds the level's
 * destructive actions (Delete panel / Delete divider) instead of a
 * loose button in the body.
 */
export function InspectorHeader({
  crumb,
  title,
  chips,
  thumb,
  actions = [],
}: {
  crumb: string
  title: string
  chips?: React.ReactNode
  thumb?: React.ReactNode
  actions?: InspectorAction[]
}) {
  const { t } = useTranslation('workspace')
  const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
      {thumb && (
        <div className="flex h-15 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-(--canvas)">
          {thumb}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs text-muted-foreground">{crumb}</span>
        <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
        {chips && <div className="mt-0.5 flex flex-wrap gap-1">{chips}</div>}
      </div>
      {actions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t('windowDialog.inspector.moreActions')}>
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          {/* Radix aligns by physical side — flip for RTL (CLAUDE.md). */}
          <DropdownMenuContent align={isRtl ? 'start' : 'end'}>
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.label}
                variant={action.destructive ? 'destructive' : 'default'}
                disabled={!action.onSelect}
                title={action.onSelect ? undefined : action.disabledReason}
                onSelect={() => action.onSelect?.()}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/** A small rounded label under the title — a system, a kind, a state. */
export function InspectorChip({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: 'neutral' | 'primary' | 'ok' | 'warn' | 'error'
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'primary' && 'bg-primary/10 text-primary',
        tone === 'ok' && 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
        tone === 'warn' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        tone === 'error' && 'bg-destructive/10 text-destructive',
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** "No issues" / "N warnings" / "N errors" for the selected level's own
 * parts — errors win, since they block saving. */
export function InspectorIssueChip({ issues }: { issues: TranslatedIssue[] }) {
  const { t } = useTranslation('workspace')
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  if (errors > 0) {
    return (
      <InspectorChip tone="error" icon={<CircleAlert className="size-3" aria-hidden="true" />}>
        {t('windowDialog.inspector.chips.errors', { count: errors })}
      </InspectorChip>
    )
  }
  if (warnings > 0) {
    return (
      <InspectorChip tone="warn" icon={<AlertTriangle className="size-3" aria-hidden="true" />}>
        {t('windowDialog.inspector.chips.warnings', { count: warnings })}
      </InspectorChip>
    )
  }
  return (
    <InspectorChip tone="ok" icon={<Check className="size-3" aria-hidden="true" />}>
      {t('windowDialog.inspector.chips.noIssues')}
    </InspectorChip>
  )
}
