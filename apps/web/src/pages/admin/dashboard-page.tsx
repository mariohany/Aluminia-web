import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboardSummaryQuery } from '@/lib/dashboard-queries'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { LeadsList } from '@/components/admin/leads/leads-list'
import { CompaniesPerMonthChart } from '@/components/admin/dashboard/companies-per-month-chart'

// Tiles for metrics that need work that doesn't exist yet — see
// admin_dashboard_planing.md's "Remaining work" section for what each one
// is still waiting on. Shown honestly rather than omitted, so the
// dashboard doesn't look like something's broken.
const BLOCKED_TILES = ['revenue'] as const

// Shared shell for every stat tile: compact `size="sm"` Card, a small
// caption, and either a skeleton or the caller's own value markup — the
// four tiles are identical in everything but that value, so only the
// value is left to each call site.
function StatTile({
  title,
  loading,
  blocked,
  children,
}: {
  title: string
  loading?: boolean
  blocked?: boolean
  children: React.ReactNode
}) {
  return (
    <Card size="sm" className={cn(blocked && 'opacity-60')}>
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        {loading ? <div className="h-6 w-16 animate-pulse rounded bg-muted" /> : children}
      </CardContent>
    </Card>
  )
}

function StatValue({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-heading text-lg font-semibold leading-tight text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

export function DashboardPage() {
  const { t, i18n } = useTranslation('admin')
  const { data, isLoading, isError } = useDashboardSummaryQuery()

  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t('dashboardPage.title')}</h1>

      {isError && <p className="text-sm text-destructive">{t('dashboardPage.error')}</p>}

      {!isError && (
        <>
          {/* Tiles sit in a narrow column beside the chart rather than as
              their own full-width row above it — four short stats and a
              chart of similar height read as one glance instead of two
              stacked bands, which is most of this page's vertical savings. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <StatTile title={t('dashboardPage.tiles.companies.title')} loading={isLoading || !data}>
                <div className="flex items-baseline gap-3">
                  <StatValue
                    value={numberFormatter.format(data?.companies.active ?? 0)}
                    label={t('dashboardPage.tiles.companies.active')}
                  />
                  <StatValue
                    value={numberFormatter.format(data?.companies.archived ?? 0)}
                    label={t('dashboardPage.tiles.companies.archived')}
                  />
                </div>
              </StatTile>

              <StatTile title={t('dashboardPage.tiles.liveSessions.title')} loading={isLoading || !data}>
                <StatValue
                  value={numberFormatter.format(data?.liveSessions.count ?? 0)}
                  label={t('dashboardPage.tiles.liveSessions.description')}
                />
              </StatTile>

              <StatTile title={t('dashboardPage.tiles.projects.title')} loading={isLoading || !data}>
                <StatValue
                  value={numberFormatter.format(data?.projects.count ?? 0)}
                  label={t('dashboardPage.tiles.projects.description')}
                />
              </StatTile>

              {BLOCKED_TILES.map((tile) => (
                <StatTile key={tile} title={t(`dashboardPage.tiles.${tile}.title`)} blocked>
                  <p className="text-[11px] text-muted-foreground">{t(`dashboardPage.tiles.${tile}.unavailable`)}</p>
                </StatTile>
              ))}
            </div>

            <CompaniesPerMonthChart />
          </div>

          <LeadsList />
        </>
      )}
    </div>
  )
}
