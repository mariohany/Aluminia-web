import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ActivityLogEntry, AuditLogEntry } from '@repo/types/logs'
import type { LogsDateRange } from '@/lib/logs-api'
import { useActivityLogInfiniteQuery, useAuditLogInfiniteQuery } from '@/lib/logs-queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { VirtualizedLogTable, type LogColumn } from '@/components/admin/admin-logs/virtualized-log-table'

const TABS = ['activity', 'audit'] as const
type Tab = (typeof TABS)[number]

export function LogsPage() {
  const { t } = useTranslation('admin')
  const [tab, setTab] = useState<Tab>('activity')

  return (
    <div className="flex h-full flex-col gap-4">
      <h1 className="shrink-0 font-heading text-xl font-semibold text-foreground">{t('logsPage.title')}</h1>

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((tabId) => (
          <Button
            key={tabId}
            variant={tab === tabId ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab(tabId)}
          >
            {t(`logsPage.tabs.${tabId}`)}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'activity' && <ActivityLogTab />}
        {tab === 'audit' && <AuditLogTab />}
      </div>
    </div>
  )
}

// Each tab owns its own date range independently — filtering the audit
// trail to a week doesn't touch what the activity tab is showing, and
// vice versa. React Query keys the infinite query on the range, so
// changing it restarts the scroll from the first chunk automatically.
function useDateRangeFilter() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  return {
    from,
    to,
    range: { from: from || undefined, to: to || undefined } satisfies LogsDateRange,
    setFrom,
    setTo,
    clear: () => {
      setFrom('')
      setTo('')
    },
  }
}

function LogDateFilter({
  idPrefix,
  from,
  to,
  onFromChange,
  onToChange,
  onClear,
}: {
  idPrefix: string
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onClear: () => void
}) {
  const { t } = useTranslation('admin')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`${idPrefix}-from`}>{t('logsPage.filters.from')}</Label>
      <Input
        id={`${idPrefix}-from`}
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onFromChange(e.target.value)}
        className="w-36"
      />
      <Label htmlFor={`${idPrefix}-to`}>{t('logsPage.filters.to')}</Label>
      <Input
        id={`${idPrefix}-to`}
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onToChange(e.target.value)}
        className="w-36"
      />
      {(from || to) && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t('logsPage.filters.clear')}
        </Button>
      )}
    </div>
  )
}

function ActivityLogTab() {
  const { t, i18n } = useTranslation('admin')
  const { from, to, range, setFrom, setTo, clear } = useDateRangeFilter()
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useActivityLogInfiniteQuery(range)

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

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>{t('logsPage.tabs.activity')}</CardTitle>
        <LogDateFilter idPrefix="activity" from={from} to={to} onFromChange={setFrom} onToChange={setTo} onClear={clear} />
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : isError ? (
          <p className="text-sm text-destructive">{t('logsPage.activityTab.error')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('logsPage.activityTab.empty')}</p>
        ) : (
          <VirtualizedLogTable
            columns={columns}
            rows={rows}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            loadingMoreLabel={t('logsPage.loadingMore')}
          />
        )}
      </CardContent>
    </Card>
  )
}

function AuditLogTab() {
  const { t, i18n } = useTranslation('admin')
  const { from, to, range, setFrom, setTo, clear } = useDateRangeFilter()
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAuditLogInfiniteQuery(range)

  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const rows: AuditLogEntry[] = data?.pages.flatMap((p) => p.items) ?? []

  const columns: LogColumn<AuditLogEntry>[] = [
    {
      key: 'actor',
      header: t('logsPage.auditTab.table.actor'),
      width: '1.6fr',
      cell: (r) => r.actorEmail ?? r.actorUserId,
      className: 'font-medium text-foreground',
    },
    { key: 'action', header: t('logsPage.auditTab.table.action'), width: '1.6fr', cell: (r) => r.action },
    {
      key: 'target',
      header: t('logsPage.auditTab.table.target'),
      width: '1.6fr',
      cell: (r) => `${r.targetType}${r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ''}`,
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

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>{t('logsPage.tabs.audit')}</CardTitle>
        <LogDateFilter idPrefix="audit" from={from} to={to} onFromChange={setFrom} onToChange={setTo} onClear={clear} />
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : isError ? (
          <p className="text-sm text-destructive">{t('logsPage.auditTab.error')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('logsPage.auditTab.empty')}</p>
        ) : (
          <VirtualizedLogTable
            columns={columns}
            rows={rows}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            loadingMoreLabel={t('logsPage.loadingMore')}
          />
        )}
      </CardContent>
    </Card>
  )
}
