import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useRecentAuditQuery } from '@/lib/logs-queries'
import { AuditIcon } from '@/components/admin/audit-entry'
import { useDescribeAudit } from '@/lib/audit-describe'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * The dashboard's side card (docs/admin_redesign_planing.md §2): the five
 * newest audit-log entries as sentences, with a link to the full Logs
 * page. Same `GET /admin/logs/audit` the Logs page reads.
 */
export function RecentActivityCard() {
  const { t, i18n } = useTranslation('admin')
  const describeAudit = useDescribeAudit()
  const { data, isLoading, isError } = useRecentAuditQuery()

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  )

  const entries = data?.items ?? []

  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardTitle>{t('dashboardPage.activity.title')}</CardTitle>
        <CardAction>
          <Link
            to="/app/logs"
            className="rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t('dashboardPage.activity.openLogs')}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <div className="h-50 animate-pulse rounded bg-muted" />
        ) : isError ? (
          <p className="text-sm text-destructive">{t('dashboardPage.activity.error')}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('dashboardPage.activity.empty')}</p>
        ) : (
          entries.map((entry) => {
            const described = describeAudit(entry)
            const sentence = described.text
            return (
              <div key={entry.id} className="flex items-start gap-2.5">
                <AuditIcon described={described} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] leading-snug text-foreground" title={sentence}>
                    {sentence}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {t('dashboardPage.activity.byline', {
                      actor: entry.actorEmail ?? t('dashboardPage.activity.removedActor'),
                      date: dateFormatter.format(new Date(entry.createdAt)),
                    })}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
