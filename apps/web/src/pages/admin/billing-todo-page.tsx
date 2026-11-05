import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronRight, CircleCheck } from 'lucide-react'
import { TODO_EXPIRING_DAYS, todoCount } from '@repo/types/billing-todo'
import { BILLING_TIME_ZONE, cairoDateOf, daysBetween } from '@repo/types/subscriptions'
import { planName } from '@/lib/bilingual'
import { useBillingTodoQuery } from '@/lib/billing-queries'
import { cn } from '@/lib/utils'

type Tone = 'warn' | 'danger' | 'muted'

const TONE: Record<Tone, string> = {
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-500',
  danger: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
}

/**
 * Billing › To-do (docs/payment_cycle_planing.md §8, Mario 2026-11-05: its
 * own page, first in the Billing group, with a count badge): sent
 * quotations waiting for payment, paid plans ending without a renewal or
 * upgrade quotation sent, trials ending, and recent payments whose amount
 * differed. Every row opens the company's Billing tab.
 */
export function BillingTodoPage() {
  const { t, i18n } = useTranslation('admin')
  const { data: todo, isPending, isError } = useBillingTodoQuery()
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: BILLING_TIME_ZONE })
  const dayOf = (iso: string) => day.format(iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso))
  const money = (currency: string, n: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(n)
  const today = cairoDateOf(new Date())
  const ago = (iso: string) => Math.max(0, daysBetween(cairoDateOf(new Date(iso)), today))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('todo.title')}</h1>
        <p className="text-[13px] text-muted-foreground">{t('todo.subtitle')}</p>
      </div>

      {isError ? (
        <p className="text-sm text-destructive">{t('todo.error')}</p>
      ) : isPending ? null : todoCount(todo) === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-card px-4 py-6 text-sm text-muted-foreground ring-1 ring-foreground/10">
          <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
          {t('todo.empty')}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t('todo.waiting.title')} hint={t('todo.waiting.hint')} items={todo.waiting}>
            {(w) => (
              <Row
                key={w.documentId}
                companyId={w.companyId}
                title={`${w.number} · ${w.companyName}`}
                detail={`${money(w.currency, w.total)} · ${t('todo.waiting.sent', { count: ago(w.sentAt) })}`}
                tag={t('todo.waiting.expires', { count: w.expiresIn })}
                tone={w.expiresIn <= TODO_EXPIRING_DAYS ? 'danger' : 'muted'}
              />
            )}
          </Section>
          <Section title={t('todo.ending.title')} hint={t('todo.ending.hint')} items={todo.endingNoQuotation}>
            {(e) => (
              <Row
                key={e.companyId}
                companyId={e.companyId}
                title={e.companyName}
                detail={`${planName(e.plan, i18n.language)} · ${t('todo.endsOn', { date: dayOf(e.endsAt) })}`}
                tag={t('todo.daysLeft', { count: e.daysLeft })}
                tone={e.daysLeft <= 5 ? 'danger' : 'warn'}
              />
            )}
          </Section>
          <Section title={t('todo.trials.title')} hint={t('todo.trials.hint')} items={todo.trialsEnding}>
            {(e) => (
              <Row
                key={e.companyId}
                companyId={e.companyId}
                title={e.companyName}
                detail={`${t('todo.trials.plan', { plan: planName(e.plan, i18n.language) })} · ${t('todo.endsOn', { date: dayOf(e.endsAt) })}`}
                tag={t('todo.daysLeft', { count: e.daysLeft })}
                tone="warn"
              />
            )}
          </Section>
          <Section title={t('todo.differences.title')} hint={t('todo.differences.hint')} items={todo.differences}>
            {(d) => {
              const gap = Math.round((d.amountReceived - d.total) * 100) / 100
              return (
                <Row
                  key={d.documentId}
                  companyId={d.companyId}
                  title={`${d.number} · ${d.companyName}`}
                  detail={d.note ? `${dayOf(d.paidOn)} · ${d.note}` : dayOf(d.paidOn)}
                  tag={`${gap > 0 ? '+' : '−'}${money(d.currency, Math.abs(gap))}`}
                  tone="warn"
                />
              )
            }}
          </Section>
        </div>
      )}
    </div>
  )
}

function Section<T>({
  title,
  hint,
  items,
  children,
}: {
  title: string
  hint: string
  items: T[]
  children: (item: T) => ReactNode
}) {
  const { t } = useTranslation('admin')
  return (
    <section className="flex flex-col gap-1 rounded-xl bg-card px-1 pt-3 pb-1 ring-1 ring-foreground/10">
      <div className="flex items-baseline gap-2 px-3 pb-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
      </div>
      <p className="px-3 pb-2 text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="px-3 pb-3 text-[13px] text-muted-foreground">{t('todo.nothing')}</p>
      ) : (
        <ul className="flex flex-col">{items.map(children)}</ul>
      )}
    </section>
  )
}

function Row({
  companyId,
  title,
  detail,
  tag,
  tone,
}: {
  companyId: string
  title: string
  detail: string
  tag: string
  tone: Tone
}) {
  return (
    <li>
      <Link
        to={`/app/companies/${companyId}?tab=billing`}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium text-foreground">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', TONE[tone])}>{tag}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
      </Link>
    </li>
  )
}

