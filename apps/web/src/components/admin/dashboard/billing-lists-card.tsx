import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { DashboardBillingCompany } from '@repo/types/dashboard'
import { BILLING_TIME_ZONE } from '@repo/types/subscriptions'
import { useDashboardBillingQuery } from '@/lib/dashboard-queries'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type DashboardListTab = 'leads' | 'endingSoon' | 'unpaid' | 'expired'

/** The tab strip over the dashboard's Leads card (B22, board bill-dash-c-tab). */
export function DashboardListTabs({
  tab,
  onChange,
  counts,
}: {
  tab: DashboardListTab
  onChange: (tab: DashboardListTab) => void
  counts: Partial<Record<DashboardListTab, number>>
}) {
  const { t } = useTranslation('admin')
  const tabs: DashboardListTab[] = ['leads', 'endingSoon', 'unpaid', 'expired']
  return (
    <div role="tablist" aria-label={t('dashboardPage.lists.label')} className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
      {tabs.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => onChange(key)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            tab === key ? 'bg-card font-semibold text-foreground shadow-xs' : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`dashboardPage.lists.${key}`)}
          {counts[key] ? (
            <span
              className={cn(
                'rounded-full px-1.5 text-[11px]',
                key === 'expired' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
              )}
            >
              {counts[key]}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

/** Ending soon, Unpaid quotations or Expired, in the Leads card's place. */
export function BillingListsCard({
  tab,
  tabs,
  className,
}: {
  tab: Exclude<DashboardListTab, 'leads'>
  tabs: React.ReactNode
  className?: string
}) {
  const { t, i18n } = useTranslation('admin')
  const { data, isLoading, isError } = useDashboardBillingQuery(true)
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: BILLING_TIME_ZONE })
  const day = (iso: string) => dateFormatter.format(new Date(`${iso}T12:00:00Z`))
  const plan = (c: DashboardBillingCompany) => (i18n.language === 'ar' ? c.planAr : c.planEn)
  const company = (id: string, name: string) => (
    <Link to={`/app/companies/${id}?tab=billing`} className="font-medium text-foreground hover:underline">
      {name}
    </Link>
  )

  const rows = data ? (tab === 'unpaid' ? data.unpaid : data[tab]) : []

  return (
    <Card size="sm" className={cn('flex flex-col', className)}>
      <CardHeader className="flex-row items-center gap-3 space-y-0">{tabs}</CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : isError ? (
          <p className="text-sm text-destructive">{t('dashboardPage.lists.error')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`dashboardPage.lists.empty.${tab}`)}</p>
        ) : tab === 'unpaid' ? (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{t('documents.number')}</TableHead>
                  <TableHead className="text-xs">{t('transactions.company')}</TableHead>
                  <TableHead className="text-end text-xs">{t('documents.total')}</TableHead>
                  <TableHead className="text-xs">{t('quotation.validUntil')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.unpaid.map((q) => (
                  <TableRow key={q.documentId}>
                    <TableCell className="font-mono text-[13px]">{q.number}</TableCell>
                    <TableCell>{company(q.companyId, q.companyName)}</TableCell>
                    <TableCell className="text-end font-mono text-[13px]">
                      {new Intl.NumberFormat(i18n.language, { style: 'currency', currency: q.currency }).format(q.total)}
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{q.validUntil ? day(q.validUntil) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{t('transactions.company')}</TableHead>
                  <TableHead className="text-xs">{t('subscription.plan')}</TableHead>
                  <TableHead className="text-xs">{t('dashboardPage.lists.endDate')}</TableHead>
                  <TableHead className="text-xs">{t('dashboardPage.lists.when')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows as DashboardBillingCompany[]).map((c) => (
                  <TableRow key={c.companyId}>
                    <TableCell>{company(c.companyId, c.companyName)}</TableCell>
                    <TableCell>{plan(c)}</TableCell>
                    <TableCell className="text-[13px]">{day(c.endDate)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-[13px]',
                        c.daysLeft < 0 || c.daysLeft <= 5 ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {c.daysLeft < 0
                        ? t('dashboardPage.lists.expiredAgo', { count: -c.daysLeft })
                        : t('dashboardPage.lists.daysLeft', { count: c.daysLeft })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
