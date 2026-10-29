import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CreditCard, FileText, Layers, Lock, Mail } from 'lucide-react'
import { PLAN_FEATURES } from '@repo/types/plans'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { BILLING_TIME_ZONE } from '@repo/types/subscriptions'
import { planName } from '@/lib/bilingual'
import {
  useCompanyBillingDocumentsQuery,
  useCompanyOverviewQuery,
  useCompanySubscriptionQuery,
} from '@/lib/company-queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfigSectionHeader } from '@/components/workspace/config/config-section-header'
import { DocumentPdfDialog } from '@/components/billing/document-pdf-dialog'
import { DocumentStatusPill } from '@/components/billing/document-status'

/**
 * Config › Subscription (docs/subscriptions_planing.md B24, board
 * `bill-ws-sub`), company admins only: the plan, its end, seats, the
 * quotations and invoices Aluminia sent (each as a PDF), what the plan
 * includes, and how to renew. Read-only: changes are made by Aluminia.
 */
export function ConfigSubscriptionPage() {
  const { t, i18n } = useTranslation('workspace')
  const { t: tAdmin } = useTranslation('admin')
  const { data: subscription } = useCompanySubscriptionQuery()
  const { data: company } = useCompanyOverviewQuery()
  const { data: documents, isError } = useCompanyBillingDocumentsQuery()
  const [viewing, setViewing] = useState<BillingDocumentSummary | null>(null)

  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
      dateStyle: 'medium',
      timeZone: BILLING_TIME_ZONE,
    }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso))
  const money = (d: BillingDocumentSummary) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: d.currency }).format(d.totals.total)

  const state = subscription?.state
  const renewal = documents?.find((d) => d.kind === 'quotation' && d.status === 'sent')
  const billingEmail = documents?.[0]?.seller.billingEmail
  const seatsShare = subscription ? Math.min(100, (subscription.seatsUsed / subscription.maxUsers) * 100) : 0

  const badge =
    state?.kind === 'free'
      ? { label: t('subscription.badge.free'), tone: 'bg-muted text-muted-foreground' }
      : state?.kind === 'trial'
        ? { label: t('subscription.badge.trial'), tone: 'bg-primary/10 text-primary' }
        : state?.kind === 'ending'
          ? { label: t('subscription.badge.ending'), tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-500' }
          : { label: t('subscription.badge.active'), tone: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' }

  const ends =
    !state || state.kind === 'free'
      ? { value: t('subscription.neverEnds'), caption: t('subscription.freeCaption') }
      : state.kind === 'expired'
        ? { value: date(state.endDate), caption: '' }
        : { value: date(state.endDate), caption: t('subscription.daysLeft', { count: state.daysLeft }) }

  return (
    <div className="flex flex-col gap-4 p-4 md:px-9 md:py-6">
      <ConfigSectionHeader title={t('config.sections.subscription.title')} />
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
          <CreditCard className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-heading text-[17px] font-semibold tracking-tight text-foreground">
            {t('config.sections.subscription.title')}
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            {t('subscription.description', { company: company?.name ?? '' })}
          </p>
        </div>
      </div>

      <div className="grid max-w-[1180px] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3.5 rounded-xl border border-border bg-card p-5 shadow-xs">
            <div className="flex items-center gap-3.5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                <Layers className="size-5" aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-[19px] font-semibold text-foreground">
                    {subscription ? t('subscription.planName', { plan: planName(subscription.plan, i18n.language) }) : '—'}
                  </span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-medium', badge.tone)}>{badge.label}</span>
                </span>
                {subscription && (
                  <span className="text-[12.5px] text-muted-foreground">
                    {t('subscription.billedIn', { company: company?.name ?? '', currency: subscription.currency })}
                  </span>
                )}
              </div>
            </div>
            <div className="grid gap-4 border-t border-border pt-3.5 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('subscription.ends')}</span>
                <span className="text-sm font-semibold text-foreground">{ends.value}</span>
                {ends.caption && <span className="text-xs text-muted-foreground">{ends.caption}</span>}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('subscription.seats')}</span>
                <span className="text-sm font-semibold text-foreground">
                  {subscription ? t('subscription.seatsUsed', {
                        active: subscription.activeUsers,
                        used: subscription.seatsUsed,
                        max: subscription.maxUsers,
                      }) : '—'}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${seatsShare}%` }} />
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('subscription.renewal')}</span>
                <span className="text-sm font-semibold text-foreground">
                  {renewal ? t('subscription.quotationSent', { date: date(renewal.lastSent?.at ?? renewal.createdAt) }) : '—'}
                </span>
                {renewal && (
                  <span className="text-xs text-muted-foreground">
                    {renewal.number} · {money(renewal)}
                  </span>
                )}
              </div>
            </div>
            <p className="flex items-start gap-2.5 rounded-lg bg-muted p-3 text-[12.5px] text-muted-foreground">
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {billingEmail ? (
                <span>
                  {t('subscription.howToRenew')}{' '}
                  <b className="text-foreground" dir="ltr">
                    {billingEmail}
                  </b>
                  . {t('subscription.howToRenewAfter')}
                </span>
              ) : (
                <span>{t('subscription.howToRenewNoEmail')}</span>
              )}
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card px-1 pt-4 pb-1 shadow-xs">
            <h2 className="px-4 text-sm font-semibold text-foreground">{t('subscription.documents')}</h2>
            {isError ? (
              <p className="px-4 py-6 text-center text-sm text-destructive">{tAdmin('documents.loadError')}</p>
            ) : !documents ? null : documents.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('subscription.noDocuments')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{tAdmin('documents.number')}</TableHead>
                    <TableHead className="text-xs">{tAdmin('documents.status.label')}</TableHead>
                    <TableHead className="text-end text-xs">{tAdmin('documents.total')}</TableHead>
                    <TableHead className="text-xs">{tAdmin('documents.created')}</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">{tAdmin('documents.actions.pdf')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <span className="flex flex-col">
                          <span className="font-mono text-[13px]">{d.number}</span>
                          <span className="text-xs text-muted-foreground">{tAdmin(`documents.kind.${d.kind}`)}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <DocumentStatusPill status={d.status} />
                      </TableCell>
                      <TableCell className="text-end font-mono text-[13px]">{money(d)}</TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">{date(d.createdAt)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={tAdmin('documents.actions.pdf')}
                          title={tAdmin('documents.actions.pdf')}
                          onClick={() => setViewing(d)}
                        >
                          <FileText aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="mb-1 text-sm font-semibold text-foreground">{t('subscription.inYourPlan')}</h2>
          {PLAN_FEATURES.map((feature) => {
            const has = subscription?.features.includes(feature) ?? false
            return (
              <div key={feature} className={cn('flex items-center gap-2.5 py-1.5 text-[13px]', !has && 'text-muted-foreground')}>
                {has ? (
                  <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <Lock className="size-4" aria-hidden="true" />
                )}
                {t(`plan.features.${feature}`)}
              </div>
            )
          })}
        </aside>
      </div>

      <DocumentPdfDialog document={viewing} onOpenChange={(open) => !open && setViewing(null)} />
    </div>
  )
}
