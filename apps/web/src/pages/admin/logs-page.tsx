import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AUDIT_AREAS, type ActivityLogEntry, type AuditArea, type AuditLogEntry } from '@repo/types/logs'
import type { LogsFilters } from '@/lib/logs-api'
import { useActivityLogInfiniteQuery, useAuditLogInfiniteQuery } from '@/lib/logs-queries'
import { useUsersQuery } from '@/lib/users-queries'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchInput } from '@/components/ui/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VirtualizedLogTable, type LogColumn } from '@/components/admin/admin-logs/virtualized-log-table'
import { AuditIcon } from '@/components/admin/audit-entry'
import { useDescribeAudit } from '@/lib/audit-describe'

const TABS = ['audit', 'activity'] as const
type Tab = (typeof TABS)[number]

/**
 * The admin logs (docs/admin_redesign_planing.md §7, option A): an
 * Audit / Activity switch, a filter row, and one infinite-scrolling
 * table. Each tab keeps its own filters.
 */
export function LogsPage() {
  const { t } = useTranslation('admin')
  const [tab, setTab] = useState<Tab>('audit')

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('logsPage.title')}</h1>
        <div role="tablist" aria-label={t('logsPage.title')} className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
          {TABS.map((tabId) => {
            const on = tab === tabId
            return (
              <button
                key={tabId}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(tabId)}
                className={cn(
                  'h-7 rounded-md px-3 text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  on ? 'bg-card font-semibold text-foreground shadow-xs' : 'font-medium text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`logsPage.tabs.${tabId}`)}
              </button>
            )
          })}
        </div>
      </div>

      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-3">
        {tab === 'audit' ? <AuditLogTab /> : <ActivityLogTab />}
      </div>
    </div>
  )
}

/** From / To day pickers, as today. */
function DateFilter({
  idPrefix,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  idPrefix: string
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}) {
  const { t } = useTranslation('admin')
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={`${idPrefix}-from`} className="text-xs text-muted-foreground">
        {t('logsPage.filters.from')}
      </Label>
      <Input
        id={`${idPrefix}-from`}
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onFromChange(e.target.value)}
        className="w-36"
      />
      <Label htmlFor={`${idPrefix}-to`} className="text-xs text-muted-foreground">
        {t('logsPage.filters.to')}
      </Label>
      <Input
        id={`${idPrefix}-to`}
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onToChange(e.target.value)}
        className="w-36"
      />
    </div>
  )
}

/** The bordered card the table (or its loading / empty / error state) sits in. */
function TableCard({
  isLoading,
  isError,
  isEmpty,
  errorText,
  emptyText,
  children,
}: {
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  errorText: string
  emptyText: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {isLoading ? (
        <div className="m-4 h-24 animate-pulse rounded bg-muted" />
      ) : isError ? (
        <p className="p-4 text-sm text-destructive">{errorText}</p>
      ) : isEmpty ? (
        <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
    </div>
  )
}

function AuditLogTab() {
  const { t, i18n } = useTranslation('admin')
  const describeAudit = useDescribeAudit()
  const { data: users } = useUsersQuery()

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [area, setArea] = useState<AuditArea | 'all'>('all')
  const [actorId, setActorId] = useState('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim())

  const filters: LogsFilters = {
    from: from || undefined,
    to: to || undefined,
    area: area === 'all' ? undefined : area,
    actorId: actorId === 'all' ? undefined : actorId,
    search: debouncedSearch || undefined,
  }
  const filtered = Boolean(from || to || area !== 'all' || actorId !== 'all' || search)
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useAuditLogInfiniteQuery(filters)

  // Audit entries are written by super admins, so they're the actors to pick from.
  const actors = useMemo(
    () => (users ?? []).filter((user) => user.role === 'super_admin').sort((a, b) => a.email.localeCompare(b.email)),
    [users],
  )

  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const rows: AuditLogEntry[] = data?.pages.flatMap((p) => p.items) ?? []

  const columns: LogColumn<AuditLogEntry>[] = [
    {
      key: 'action',
      header: t('logsPage.auditTab.table.action'),
      width: '3fr',
      cell: (r) => {
        const described = describeAudit(r)
        return (
          <span className="flex min-w-0 items-center gap-2.5" title={described.text}>
            <AuditIcon described={described} />
            <span className="truncate text-foreground">{described.text}</span>
          </span>
        )
      },
    },
    {
      key: 'actor',
      header: t('logsPage.auditTab.table.actor'),
      width: '1.6fr',
      cell: (r) => r.actorEmail ?? t('dashboardPage.activity.removedActor'),
      className: 'text-muted-foreground',
    },
    {
      key: 'date',
      header: t('logsPage.auditTab.table.date'),
      width: '1.2fr',
      cell: (r) => dateTimeFormatter.format(new Date(r.createdAt)),
      className: 'text-muted-foreground',
    },
  ]

  const clear = () => {
    setFrom('')
    setTo('')
    setArea('all')
    setActorId('all')
    setSearch('')
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <DateFilter idPrefix="audit" from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <Select value={area} onValueChange={(value) => setArea(value as AuditArea | 'all')}>
          <SelectTrigger className="w-40" aria-label={t('logsPage.filters.area')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('logsPage.filters.allAreas')}</SelectItem>
            {AUDIT_AREAS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`logsPage.filters.areas.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actorId} onValueChange={setActorId}>
          <SelectTrigger className="w-52" aria-label={t('logsPage.auditTab.table.actor')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('logsPage.filters.allActors')}</SelectItem>
            {actors.map((actor) => (
              <SelectItem key={actor.id} value={actor.id}>
                {actor.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clear}>
            {t('logsPage.filters.clearAll')}
          </Button>
        )}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('logsPage.filters.searchAudit')}
          aria-label={t('logsPage.filters.searchAudit')}
          className="ms-auto max-w-64"
        />
      </div>

      <TableCard
        isLoading={isLoading}
        isError={isError}
        isEmpty={rows.length === 0}
        errorText={t('logsPage.auditTab.error')}
        emptyText={filtered ? t('logsPage.noMatches') : t('logsPage.auditTab.empty')}
      >
        <VirtualizedLogTable
          columns={columns}
          rows={rows}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          loadingMoreLabel={t('logsPage.loadingMore')}
        />
      </TableCard>
    </>
  )
}

function ActivityLogTab() {
  const { t, i18n } = useTranslation('admin')

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim())

  const filtered = Boolean(from || to || search)
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useActivityLogInfiniteQuery({
    from: from || undefined,
    to: to || undefined,
    search: debouncedSearch || undefined,
  })

  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const rows: ActivityLogEntry[] = data?.pages.flatMap((p) => p.items) ?? []

  const columns: LogColumn<ActivityLogEntry>[] = [
    { key: 'company', header: t('logsPage.activityTab.table.company'), width: '2fr', cell: (r) => r.companyName, className: 'font-medium text-foreground' },
    { key: 'plan', header: t('logsPage.activityTab.table.plan'), width: '1fr', cell: (r) => r.plan },
    { key: 'seats', header: t('logsPage.activityTab.table.seats'), width: '0.6fr', cell: (r) => r.maxUsers },
    { key: 'notes', header: t('logsPage.activityTab.table.notes'), width: '2fr', cell: (r) => r.notes ?? '—', className: 'text-muted-foreground' },
    {
      key: 'date',
      header: t('logsPage.activityTab.table.date'),
      width: '1.4fr',
      cell: (r) => dateTimeFormatter.format(new Date(r.effectiveFrom)),
      className: 'text-muted-foreground',
    },
  ]

  const clear = () => {
    setFrom('')
    setTo('')
    setSearch('')
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <DateFilter idPrefix="activity" from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clear}>
            {t('logsPage.filters.clearAll')}
          </Button>
        )}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('logsPage.filters.searchActivity')}
          aria-label={t('logsPage.filters.searchActivity')}
          className="ms-auto max-w-64"
        />
      </div>

      <TableCard
        isLoading={isLoading}
        isError={isError}
        isEmpty={rows.length === 0}
        errorText={t('logsPage.activityTab.error')}
        emptyText={filtered ? t('logsPage.noMatches') : t('logsPage.activityTab.empty')}
      >
        <VirtualizedLogTable
          columns={columns}
          rows={rows}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          loadingMoreLabel={t('logsPage.loadingMore')}
        />
      </TableCard>
    </>
  )
}
