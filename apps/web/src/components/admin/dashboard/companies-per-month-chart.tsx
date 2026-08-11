import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { useCompaniesPerMonthQuery } from '@/lib/dashboard-queries'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface ChartPoint {
  month: string
  label: string
  count: number
}

// Single series (one metric, company signups), so no legend box — the
// card title already says what's plotted. Custom tooltip instead of
// recharts' default so it picks up the app's popover tokens rather than
// a plain white box, and so the value leads with the month secondary.
function CompaniesTooltip({ active, payload }: TooltipContentProps) {
  const { t } = useTranslation('admin')
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as ChartPoint
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <div className="font-medium text-popover-foreground">
        {t('dashboardPage.chart.tooltipCount', { count: point.count })}
      </div>
      <div className="text-muted-foreground">{point.label}</div>
    </div>
  )
}

export function CompaniesPerMonthChart() {
  const { t, i18n } = useTranslation('admin')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { data, isLoading, isError } = useCompaniesPerMonthQuery({ from: from || undefined, to: to || undefined })

  // Defaults to the current calendar year server-side, so within a
  // single year "Jan"/"Feb" is unambiguous — a custom range can span
  // years, where the month alone would be misleading.
  const monthFormatter = useMemo(() => {
    const spansMultipleYears = !!data && new Set(data.map((point) => point.month.slice(0, 4))).size > 1
    return new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      year: spansMultipleYears ? 'numeric' : undefined,
    })
  }, [data, i18n.language])

  const chartData: ChartPoint[] = useMemo(
    () =>
      (data ?? []).map((point) => ({
        month: point.month,
        label: monthFormatter.format(new Date(`${point.month}T00:00:00.000Z`)),
        count: point.count,
      })),
    [data, monthFormatter],
  )

  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <CardTitle>{t('dashboardPage.chart.title')}</CardTitle>
        <CardDescription className="text-xs">{t('dashboardPage.chart.description')}</CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center gap-1.5">
            <Label htmlFor="companies-chart-from" className="text-[11px] text-muted-foreground">
              {t('dashboardPage.chart.filters.from')}
            </Label>
            <Input
              id="companies-chart-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="w-32"
            />
            <Label htmlFor="companies-chart-to" className="text-[11px] text-muted-foreground">
              {t('dashboardPage.chart.filters.to')}
            </Label>
            <Input
              id="companies-chart-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="w-32"
            />
            {(from || to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom('')
                  setTo('')
                }}
              >
                {t('dashboardPage.chart.filters.clear')}
              </Button>
            )}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">{t('dashboardPage.chart.error')}</p>
        ) : isLoading || !data ? (
          <div className="h-52 animate-pulse rounded bg-muted" />
        ) : (
          <ResponsiveContainer width="100%" height={208}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={24}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <Tooltip content={(props) => <CompaniesTooltip {...props} />} cursor={{ fill: 'var(--muted)' }} />
              <Bar dataKey="count" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
