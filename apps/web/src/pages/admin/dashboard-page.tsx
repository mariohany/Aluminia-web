import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboardSummaryQuery } from '@/lib/dashboard-queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// Tiles for metrics that need work that doesn't exist yet (Phase 11
// projects, a priced `billing` schema, the landing page's lead backend —
// see admin_dashboard_planing.md). Shown honestly rather than omitted, so
// the dashboard doesn't look like something's broken.
const BLOCKED_TILES = ['projects', 'revenue', 'leads'] as const

export function DashboardPage() {
  const { t, i18n } = useTranslation('admin')
  const { data, isLoading, isError } = useDashboardSummaryQuery()

  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  )

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t('dashboardPage.title')}</h1>

      {isError && <p className="text-sm text-destructive">{t('dashboardPage.error')}</p>}

      {!isError && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('dashboardPage.tiles.companies.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <div className="h-8 animate-pulse rounded bg-muted" />
                ) : (
                  <div className="flex items-baseline gap-4">
                    <div>
                      <div className="font-heading text-2xl font-semibold text-foreground">
                        {numberFormatter.format(data.companies.active)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('dashboardPage.tiles.companies.active')}
                      </div>
                    </div>
                    <div>
                      <div className="font-heading text-2xl font-semibold text-foreground">
                        {numberFormatter.format(data.companies.archived)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('dashboardPage.tiles.companies.archived')}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('dashboardPage.tiles.liveSessions.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <div className="h-8 animate-pulse rounded bg-muted" />
                ) : (
                  <>
                    <div className="font-heading text-2xl font-semibold text-foreground">
                      {numberFormatter.format(data.liveSessions.count)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('dashboardPage.tiles.liveSessions.description')}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {BLOCKED_TILES.map((tile) => (
              <Card key={tile} className="opacity-60">
                <CardHeader>
                  <CardTitle>{t(`dashboardPage.tiles.${tile}.title`)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {t(`dashboardPage.tiles.${tile}.unavailable`)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('dashboardPage.tiles.planDistribution.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <div className="h-24 animate-pulse rounded bg-muted" />
                ) : data.planDistribution.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('dashboardPage.tiles.planDistribution.empty')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {data.planDistribution.map((entry) => (
                      <li key={entry.plan} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{entry.plan}</span>
                        <Badge variant="outline">{numberFormatter.format(entry.count)}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('dashboardPage.tiles.recentActivity.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <div className="h-24 animate-pulse rounded bg-muted" />
                ) : data.recentActivity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('dashboardPage.tiles.recentActivity.empty')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {data.recentActivity.map((entry) => (
                      <li key={entry.id} className="flex flex-col gap-0.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{entry.companyName}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {dateFormatter.format(new Date(entry.effectiveFrom))}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {entry.plan} · {t('dashboardPage.tiles.recentActivity.seats', { n: entry.maxUsers })}
                          {entry.notes ? ` · ${entry.notes}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
