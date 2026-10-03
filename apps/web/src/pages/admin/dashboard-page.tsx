import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboardSummaryQuery } from '@/lib/dashboard-queries'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LeadsList } from '@/components/admin/leads/leads-list'
import { CompaniesPerMonthChart } from '@/components/admin/dashboard/companies-per-month-chart'
import { RecentActivityCard } from '@/components/admin/dashboard/recent-activity-card'

// One headline number, kept short so the leads table gets the room
// (Mario, 2026-10-03). Fixed-height title row (the Revenue badge can't
// make one tile taller) and `h-full`, so the four line up.
function StatTile({
  title,
  badge,
  value,
  caption,
  loading,
}: {
  title: string
  badge?: string
  value: string
  caption: string
  loading?: boolean
}) {
  return (
    <Card size="sm" className="h-full">
      <CardContent className="flex h-full flex-col gap-1">
        <span className="flex h-5 items-center gap-2 text-xs text-muted-foreground">
          {title}
          {badge && (
            <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px] font-medium">
              {badge}
            </Badge>
          )}
        </span>
        {loading ? (
          <div className="h-7 w-16 animate-pulse rounded bg-muted" />
        ) : (
          <span className="font-heading text-2xl leading-7 font-semibold tracking-tight text-foreground">{value}</span>
        )}
        <span className="truncate text-xs text-muted-foreground">{caption}</span>
      </CardContent>
    </Card>
  )
}

/** "Good morning / afternoon / evening" from the viewer's own clock. */
function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/**
 * The admin dashboard (docs/admin_redesign_planing.md §2): greeting,
 * four compact headline tiles, the new-companies chart beside the recent
 * admin activity, and the leads table filling the rest of the screen.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation('admin')
  const { data, isLoading, isError } = useDashboardSummaryQuery()

  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])
  const now = new Date()
  const today = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }).format(now)

  const loading = isLoading || !data
  const companies = data ? data.companies.active + data.companies.archived : 0

  return (
    // From lg up the page fills the viewport-bounded <main> (admin-layout)
    // and the leads card takes whatever height is left, scrolling inside.
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <div className="flex shrink-0 flex-col gap-0.5">
        <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">
          {t(`dashboardPage.greeting.${greetingKey(now.getHours())}`)}
        </h1>
        <p className="text-sm text-muted-foreground">{t('dashboardPage.subtitle', { date: today })}</p>
      </div>

      {isError && <p className="text-sm text-destructive">{t('dashboardPage.error')}</p>}

      {!isError && (
        <>
          <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              title={t('dashboardPage.tiles.companies.title')}
              loading={loading}
              value={numberFormatter.format(companies)}
              caption={t('dashboardPage.tiles.companies.caption', {
                active: numberFormatter.format(data?.companies.active ?? 0),
                archived: numberFormatter.format(data?.companies.archived ?? 0),
              })}
            />
            <StatTile
              title={t('dashboardPage.tiles.liveSessions.title')}
              loading={loading}
              value={numberFormatter.format(data?.liveSessions.count ?? 0)}
              caption={t('dashboardPage.tiles.liveSessions.description')}
            />
            <StatTile
              title={t('dashboardPage.tiles.projects.title')}
              loading={loading}
              value={numberFormatter.format(data?.projects.count ?? 0)}
              caption={t('dashboardPage.tiles.projects.description')}
            />
            <StatTile
              title={t('dashboardPage.tiles.revenue.title')}
              badge={t('dashboardPage.tiles.revenue.soon')}
              value="—"
              caption={t('dashboardPage.tiles.revenue.unavailable')}
            />
          </div>

          <div className="grid shrink-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
            <CompaniesPerMonthChart />
            <RecentActivityCard />
          </div>

          <LeadsList className="lg:min-h-64 lg:flex-1" />
        </>
      )}
    </div>
  )
}
