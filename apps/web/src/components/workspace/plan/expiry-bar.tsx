import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, TriangleAlert, X } from 'lucide-react'
import { BILLING_TIME_ZONE, cairoDateOf } from '@repo/types/subscriptions'
import { useCompanyAlertsQuery, useCompanyOverviewQuery } from '@/lib/company-queries'
import { cn } from '@/lib/utils'

const CLOSED_KEY = 'aluminia.expiryBar.closedOn'

function closedToday(today: string): boolean {
  try {
    return localStorage.getItem(CLOSED_KEY) === today
  } catch {
    return false
  }
}

/**
 * The whole workspace under the expiry bar (docs/subscriptions_planing.md
 * B15, boards bill-ws-bar-admin / -user): one line across the top for
 * every user in a paid plan's last 30 days, yellow, then red in the last
 * 5. Only company admins get "Go to subscription". Yellow can be closed
 * until tomorrow (remembered in this browser only, a convenience); red
 * can't. Its data comes from the alerts call made once per app open (Q2).
 */
export function ExpiryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh flex-col">
      <ExpiryBar />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function ExpiryBar() {
  const { t, i18n } = useTranslation('workspace')
  const { data } = useCompanyAlertsQuery()
  const { data: company } = useCompanyOverviewQuery()
  const today = cairoDateOf(new Date())
  const [closed, setClosed] = useState(() => closedToday(today))
  const ending = data?.ending
  if (!ending) return null
  const red = ending.tone === 'red'
  if (closed && !red) return null

  const date = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    dateStyle: 'long',
    timeZone: BILLING_TIME_ZONE,
  }).format(new Date(`${ending.endDate}T12:00:00Z`))

  return (
    <div
      role="alert"
      className={cn(
        'flex min-h-10 shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 text-[13px]',
        red ? 'bg-expiry-danger text-expiry-danger-foreground' : 'bg-expiry-warn text-expiry-warn-foreground',
      )}
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
      <span>
        <b>
          {t('expiryBar.title', { company: (i18n.language === 'ar' ? company?.nameAr : null) ?? company?.name ?? '', count: ending.daysLeft })}
        </b>{' '}
        — {t('expiryBar.on', { date })} {t(ending.canRenew ? 'expiryBar.admin' : 'expiryBar.user')}
      </span>
      {ending.canRenew && (
        <Link
          to="/workspace/config/subscription"
          className={cn(
            'inline-flex h-6.5 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold whitespace-nowrap',
            red ? 'bg-expiry-danger-foreground text-expiry-danger' : 'bg-expiry-warn-foreground text-expiry-warn',
          )}
        >
          {t('expiryBar.go')}
          <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
        </Link>
      )}
      {!red && (
        <button
          type="button"
          aria-label={t('expiryBar.close')}
          className="rounded p-0.5 opacity-70 hover:opacity-100"
          onClick={() => {
            try {
              localStorage.setItem(CLOSED_KEY, today)
            } catch {
              // A blocked storage only means it shows again next time.
            }
            setClosed(true)
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
