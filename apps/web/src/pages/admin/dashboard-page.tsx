import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboardSummaryQuery } from '@/lib/dashboard-queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LeadsList } from '@/components/admin/leads/leads-list'

// Tiles for metrics that need work that doesn't exist yet — see
// admin_dashboard_planing.md's "Remaining work" section for what each one
// is still waiting on. Shown honestly rather than omitted, so the
// dashboard doesn't look like something's broken.
const BLOCKED_TILES = ['revenue'] as const

export function DashboardPage() {
  const { t, i18n } = useTranslation('admin')
  const { data, isLoading, isError } = useDashboardSummaryQuery()

  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])

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

            <Card>
              <CardHeader>
                <CardTitle>{t('dashboardPage.tiles.projects.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <div className="h-8 animate-pulse rounded bg-muted" />
                ) : (
                  <>
                    <div className="font-heading text-2xl font-semibold text-foreground">
                      {numberFormatter.format(data.projects.count)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('dashboardPage.tiles.projects.description')}
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

          <LeadsList />
        </>
      )}
    </div>
  )
}
