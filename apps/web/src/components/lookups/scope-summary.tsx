import { useTranslation } from 'react-i18next'
import type { LookupRowScope } from '@/components/lookups/lookup-table-section'
import { cn } from '@/lib/utils'

/**
 * The company Data page's table heading (docs/workspace_redesign_planing.md
 * §4): the table's name, then "186 · 3 ours" counted off the merged rows
 * the section already holds. Only rendered when a section gets
 * `rowScope` — the admin Data warehouse never passes it, so its tabs
 * keep naming the table on their own.
 */
export function ScopeSummary<TRow>({
  title,
  rows,
  rowScope,
}: {
  title: string
  rows: TRow[]
  rowScope: (row: TRow) => LookupRowScope
}) {
  const { t, i18n } = useTranslation('lookups')
  const numberFormatter = new Intl.NumberFormat(i18n.language)
  const ours = rows.filter((row) => rowScope(row) === 'company').length

  return (
    <div className="flex shrink-0 items-baseline gap-2 pe-2">
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      <span className="text-xs text-muted-foreground">
        {numberFormatter.format(rows.length)}
        {ours > 0 && (
          <>
            {' · '}
            <span className="text-primary">{t('scope.oursCount', { count: ours })}</span>
          </>
        )}
      </span>
    </div>
  )
}

export type ScopeFilterValue = '__all' | LookupRowScope

const OPTIONS: { value: ScopeFilterValue; labelKey: string }[] = [
  { value: '__all', labelKey: 'scope.all' },
  { value: 'platform', labelKey: 'scope.platform' },
  { value: 'company', labelKey: 'scope.ours' },
]

/** All / Platform / Ours as a segmented toggle (replaces the old Select). */
export function ScopeToggle({
  value,
  onChange,
}: {
  value: ScopeFilterValue
  onChange: (value: ScopeFilterValue) => void
}) {
  const { t } = useTranslation('lookups')

  return (
    <div
      role="group"
      aria-label={t('scope.columnHeader')}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
    >
      {OPTIONS.map((option) => {
        const on = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 rounded-md px-2.5 text-[12.5px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              on ? 'bg-muted font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
