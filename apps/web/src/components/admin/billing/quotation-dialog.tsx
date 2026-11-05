import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowRight, Check } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import type { CompanyDetail } from '@repo/types/companies'
import {
  DISCOUNT_KINDS,
  QUOTATION_MONTHS,
  QUOTATION_VALID_DAYS,
  documentTotals,
  periodEnd,
  planPeriodEgp,
  quotationInputSchema,
  round2,
  unusedCredit,
  upgradeHasCredit,
  upgradePeriod,
  type BillingDocumentSummary,
  type QuotationInput,
  type QuotationMonths,
  type QuotationPurpose,
} from '@repo/types/billing-documents'
import { MAX_PLAN_SEATS, PAID_PLAN_KEYS, type PlanSummary } from '@repo/types/plans'
import {
  BILLING_CURRENCIES,
  BILLING_TIME_ZONE,
  addDays,
  cairoDateOf,
  daysBetween,
  endOfCairoDay,
  type BillingCurrency,
} from '@repo/types/subscriptions'
import { apiErrorCode, apiErrorMessage } from '@/lib/api-client'
import { planName } from '@/lib/bilingual'
import {
  useCompanyDocumentsQuery,
  useFxQuoteQuery,
  useSaveQuotationMutation,
  useSendDefaultsQuery,
} from '@/lib/billing-queries'
import { cn } from '@/lib/utils'
import { usePlansQuery } from '@/lib/plans-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PriceInput } from '@/components/ui/price-input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmailStep } from './email-step'

/** B8: an active paid plan renews from the day after its end; Free, a
 * trial or an ended plan from today. The API moves it again on payment. */
function renewalStart(company: CompanyDetail, today: string): string {
  const end = company.endsAt ? cairoDateOf(new Date(company.endsAt)) : null
  return company.plan.key !== 'free' && !company.isTrial && end && end >= today ? addDays(end, 1) : today
}

function priceOf(plans: PlanSummary[] | undefined, key: string, months: QuotationMonths, fxRate: number | null) {
  const plan = plans?.find((p) => p.key === key)
  if (!plan) return 0
  const egp = planPeriodEgp(plan, months)
  return fxRate ? round2(egp / fxRate) : egp
}

/** What an upgrade needs to know about the running period (P11). */
interface UpgradeContext {
  today: string
  /** The company's current end, YYYY-MM-DD (Cairo). */
  currentEnd: string
  /** Paid invoices in issue order: the credit's sources. */
  invoices: BillingDocumentSummary[]
}

/** The invoice whose period is running now: the one ending last. */
function currentInvoice(ctx: UpgradeContext) {
  return ctx.invoices.reduce<BillingDocumentSummary | undefined>((last, d) => (!last || d.endsOn > last.endsOn ? d : last), undefined)
}

/**
 * An upgrade's dates and plan price in EGP (P11, Mario 2026-11-05): a length
 * that runs past the current end starts today at the plan's full price;
 * otherwise the end stays and the days left are charged at the new plan's
 * rate for the length paid. Extra seats on the same plan to the same end
 * cost only their own line.
 */
function upgradeTerms(ctx: UpgradeContext, plans: PlanSummary[] | undefined, companyPlanKey: string, planKey: string, months: QuotationMonths) {
  const period = upgradePeriod(ctx.today, ctx.currentEnd, months)
  const plan = plans?.find((p) => p.key === planKey)
  const samePlan = planKey === companyPlanKey
  let priceEgp = 0
  if (plan && period.full) priceEgp = planPeriodEgp(plan, months)
  else if (plan && !samePlan) {
    const paid = currentInvoice(ctx)
    const length = paid?.months ?? months
    const days = paid ? daysBetween(paid.startsOn, paid.endsOn) + 1 : daysBetween(ctx.today, periodEnd(ctx.today, months)) + 1
    priceEgp = round2((planPeriodEgp(plan, length) * (daysBetween(ctx.today, ctx.currentEnd) + 1)) / days)
  }
  return { ...period, samePlan, priceEgp }
}

function blankForm(
  company: CompanyDetail,
  plans: PlanSummary[] | undefined,
  today: string,
  purpose: QuotationPurpose,
  ctx: UpgradeContext | null,
): QuotationInput {
  const current = PAID_PLAN_KEYS.find((key) => key === company.plan.key)
  const paid = ctx ? currentInvoice(ctx) : undefined
  const currency = company.currency
  const base = {
    purpose,
    extraSeats: 0,
    extraSeatPrice: 0,
    currency,
    fxRate: null,
    discountKind: null,
    discountValue: null,
    vatRate: company.vatRate,
    validUntil: addDays(today, QUOTATION_VALID_DAYS),
    note: null,
  }
  if (purpose === 'upgrade' && ctx && current) {
    // The next plan up (PAID_PLAN_KEYS is in plan order), else more seats
    // on the top plan.
    const planKey = PAID_PLAN_KEYS[PAID_PLAN_KEYS.indexOf(current) + 1] ?? current
    const plan = plans?.find((p) => p.key === planKey)
    const months = paid?.months ?? 12
    const terms = upgradeTerms(ctx, plans, company.plan.key, planKey, months)
    return {
      ...base,
      planKey: planKey as QuotationInput['planKey'],
      extraSeats: Math.max(0, company.maxUsers - (plan?.seats ?? 0)),
      months,
      startsOn: terms.startsOn,
      endsOn: terms.endsOn,
      unitPrice: currency === 'EGP' ? terms.priceEgp : 0,
    }
  }
  // A renewal repeats what is paid now (§3 step 11); a new one starts on Pro.
  const planKey = current ?? 'pro'
  const months = (purpose === 'renewal' ? paid?.months : undefined) ?? 12
  const startsOn = renewalStart(company, today)
  const sameCurrency = paid?.currency === currency
  return {
    ...base,
    planKey,
    extraSeats: purpose === 'renewal' ? (paid?.extraSeats ?? 0) : 0,
    extraSeatPrice: purpose === 'renewal' && sameCurrency ? (paid?.extraSeatPrice ?? 0) : 0,
    months,
    startsOn,
    endsOn: periodEnd(startsOn, months),
    unitPrice: currency === 'EGP' ? priceOf(plans, planKey, months, null) : 0,
  }
}

function fromDocument(doc: BillingDocumentSummary): QuotationInput {
  return {
    purpose: doc.purpose,
    planKey: doc.plan.key as QuotationInput['planKey'],
    extraSeats: doc.extraSeats,
    extraSeatPrice: doc.extraSeatPrice,
    months: doc.months,
    startsOn: doc.startsOn,
    endsOn: doc.endsOn,
    currency: doc.currency,
    fxRate: doc.fxRate,
    unitPrice: doc.unitPrice,
    discountKind: doc.discountKind,
    discountValue: doc.discountValue,
    vatRate: doc.vatRate,
    validUntil: doc.validUntil ?? '',
    note: doc.note,
  }
}

/**
 * New quotation (docs/subscriptions_planing.md B5–B7, B18, board
 * `bill-q-new`), step 1: plan, extra seats at a typed price (P15), duration
 * (1/3/6/12 months; 12 = the annual price), dates (B8 start, editable end),
 * currency at today's rate (frozen on the quotation), price (overwritable),
 * discount, VAT % and valid until (14 days, Q3). `purpose` (P30) is new,
 * renewal (prefilled from what is paid now) or upgrade (P11: dates and
 * price worked out, the credit for unused days shown in the totals). Step
 * 2 emails it (B16, B18): Next saves the draft and opens the Email step;
 * Back edits that same draft. Also edits a draft (`document`).
 */
export function QuotationDialog({
  company,
  document,
  purpose: newPurpose = 'new',
  open,
  onOpenChange,
}: {
  company: CompanyDetail
  document?: BillingDocumentSummary
  purpose?: QuotationPurpose
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation('admin')
  const { data: plans } = usePlansQuery()
  const save = useSaveQuotationMutation(company.id)
  const today = cairoDateOf(new Date())
  const purpose = document?.purpose ?? newPurpose
  const companyPlanKey = company.plan.key
  const upgrade = purpose === 'upgrade'
  // Renewals and upgrades start from what is paid now (P11, §3 step 11).
  const { data: documents } = useCompanyDocumentsQuery(company.id)
  const ctx = useMemo<UpgradeContext | null>(
    () =>
      documents && company.endsAt
        ? {
            today,
            currentEnd: cairoDateOf(new Date(company.endsAt)),
            invoices: documents
              .filter((d) => d.kind === 'invoice')
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          }
        : null,
    [documents, company.endsAt, today],
  )
  // P16: an upgrade never lowers the plan.
  const currentIndex = PAID_PLAN_KEYS.findIndex((key) => key === company.plan.key)
  const paidPlans = (plans ?? []).filter(
    (p) => p.key !== 'free' && (!upgrade || PAID_PLAN_KEYS.findIndex((key) => key === p.key) >= currentIndex),
  )
  // Step 2 works on the saved draft; Back edits that same draft.
  const [step, setStep] = useState<1 | 2>(1)
  const [saved, setSaved] = useState<BillingDocumentSummary | null>(null)
  const draftId = saved?.id ?? document?.id ?? null
  const sendDefaults = useSendDefaultsQuery(step === 2 ? (saved?.id ?? null) : null)
  const admins = company.users
    .filter((u) => u.role === UserRole.COMPANY_ADMIN && u.status === 'active')
    .map((u) => u.email)

  const {
    control,
    register,
    reset,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors },
  } = useForm<QuotationInput>({ resolver: zodResolver(quotationInputSchema) })

  // Filled once per opening (the parent remounts this per opening, its
  // `key`), when the plans are known: a refetch of the company after Next
  // saved the draft must not reset what Back shows.
  const filled = useRef(false)
  const ready = !!plans && (purpose === 'new' || !!documents)
  useEffect(() => {
    if (!open || filled.current || !ready) return
    filled.current = true
    reset(document ? fromDocument(document) : blankForm(company, plans, today, purpose, ctx))
  }, [open, document, company, plans, today, reset, ready, purpose, ctx])

  const values = useWatch({ control }) as Partial<QuotationInput>
  const currency = (values.currency ?? company.currency) as BillingCurrency
  const fx = useFxQuoteQuery(currency, open)

  // Today's rate prefills an empty rate field (and the price with it).
  const quote = fx.data
  useEffect(() => {
    if (!quote?.egpPerUnit || quote.currency !== getValues('currency') || getValues('fxRate')) return
    setValue('fxRate', quote.egpPerUnit)
    const rate = quote.egpPerUnit
    const egpPrice =
      upgrade && ctx
        ? upgradeTerms(ctx, plans, companyPlanKey, getValues('planKey'), getValues('months')).priceEgp
        : priceOf(plans, getValues('planKey'), getValues('months'), null)
    setValue('unitPrice', round2(egpPrice / rate))
  }, [quote, plans, getValues, setValue, upgrade, ctx, companyPlanKey])

  /** Plan, months or rate changed: the plan's price again (an upgrade's
   * dates too). */
  function reprice(next: Partial<Pick<QuotationInput, 'planKey' | 'months' | 'fxRate'>>) {
    const v = { ...getValues(), ...next }
    const rate = v.currency === 'EGP' ? null : v.fxRate
    if (upgrade && ctx) {
      const terms = upgradeTerms(ctx, plans, company.plan.key, v.planKey, v.months)
      setValue('startsOn', terms.startsOn, { shouldDirty: true })
      setValue('endsOn', terms.endsOn, { shouldDirty: true })
      setValue('unitPrice', rate ? round2(terms.priceEgp / rate) : rate === null && v.currency !== 'EGP' ? 0 : terms.priceEgp, {
        shouldDirty: true,
      })
      return
    }
    setValue('unitPrice', priceOf(plans, v.planKey, v.months, rate), { shouldDirty: true })
  }

  // The upgrade's credit, as the API will work it out (P11).
  const terms =
    upgrade && ctx && values.planKey && values.months
      ? upgradeTerms(ctx, plans, company.plan.key, values.planKey, values.months)
      : null
  const credit =
    terms && ctx && upgradeHasCredit(terms.samePlan, terms.full)
      ? unusedCredit(
          ctx.invoices.map((d) => ({
            number: d.number,
            startsOn: d.startsOn,
            endsOn: d.endsOn,
            valueEgp: round2((d.totals.subtotal - d.totals.discountAmount) * (d.fxRate ?? 1)),
          })),
          today,
          ctx.currentEnd,
        )
      : []
  const creditEgp = round2(credit.reduce((sum, line) => sum + line.amountEgp, 0))
  const totals = documentTotals({
    unitPrice: Number(values.unitPrice) || 0,
    extraSeats: Number(values.extraSeats) || 0,
    extraSeatPrice: Number(values.extraSeatPrice) || 0,
    discountKind: values.discountKind ?? null,
    discountValue: values.discountValue ?? null,
    vatRate: Number(values.vatRate) || 0,
    fxRate: values.fxRate ?? null,
    creditAmount: values.fxRate ? round2(creditEgp / values.fxRate) : creditEgp,
  })
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency, minimumFractionDigits: 2 })
  const egp = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EGP', minimumFractionDigits: 2 })
  const plan = plans?.find((p) => p.key === values.planKey)
  const totalSeats = (plan?.seats ?? 0) + (Number(values.extraSeats) || 0)
  const seatsTooFew = !!plan && totalSeats < (upgrade ? Math.max(company.userCount, company.maxUsers) : company.userCount)
  const dayFormatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: BILLING_TIME_ZONE })
  const showDay = (date: string | undefined) => (date ? dayFormatter.format(endOfCairoDay(date)) : '—')
  const saving =
    plan && values.months === 12 && plan.monthlyEgp && plan.annualEgp
      ? Math.round(100 - (plan.annualEgp / (12 * plan.monthlyEgp)) * 100)
      : null

  /** Saves the draft; then closes (Save quotation) or goes on to Email (Next). */
  const submit = (next: 'close' | 'email') => async (input: QuotationInput) => {
    try {
      const doc = await save.mutateAsync({ id: draftId, input })
      if (next === 'email') {
        setSaved(doc)
        setStep(2)
        return
      }
      toast.success(t('quotation.saved', { number: doc.number }))
      onOpenChange(false)
    } catch (err) {
      const code = apiErrorCode(err)
      toast.error(
        code === 'billing_profile_missing'
          ? t('quotation.errors.noBillingProfile')
          : apiErrorMessage(err, t('quotation.errors.save')),
      )
    }
  }

  const error = (name: keyof QuotationInput) =>
    errors[name] && <p className="text-xs text-destructive">{t(`quotation.errors.${name}`, t('quotation.errors.field'))}</p>

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === 2 && saved
              ? t('email.title', { number: saved.number })
              : (saved ?? document)
                ? t('quotation.editTitle', { number: (saved ?? document)?.number })
                : t(`quotation.titles.${purpose}`)}
          </DialogTitle>
          <DialogDescription>{t('quotation.description', { company: company.name })}</DialogDescription>
          <ol className="mt-1 flex items-center gap-2 text-xs" aria-label={t('quotation.steps.label')}>
            {([1, 2] as const).map((n) => (
              <li key={n} className="flex items-center gap-2">
                {n === 2 && <span aria-hidden="true" className="h-px w-6 bg-border" />}
                <span
                  aria-current={step === n ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-1.5',
                    step === n ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full text-[11px]',
                      step === n ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    )}
                  >
                    {n}
                  </span>
                  {t(n === 1 ? 'quotation.steps.quotation' : 'quotation.steps.email')}
                </span>
              </li>
            ))}
          </ol>
        </DialogHeader>

        {step === 2 && saved ? (
          sendDefaults.data ? (
            <EmailStep
              document={saved}
              recipients={admins}
              subject={sendDefaults.data.subject}
              onBack={() => setStep(1)}
              onCancel={() => onOpenChange(false)}
              onSent={() => onOpenChange(false)}
            />
          ) : null
        ) : (
          <form onSubmit={(e) => void handleSubmit(submit('close'))(e)} noValidate className="flex flex-col gap-4">

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="quotation-plan">{t('quotation.plan')}</Label>
                <Controller
                  control={control}
                  name="planKey"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        if (!value) return
                        field.onChange(value)
                        reprice({ planKey: value as QuotationInput['planKey'] })
                      }}
                    >
                      <SelectTrigger id="quotation-plan" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {paidPlans.map((p) => (
                          <SelectItem key={p.key} value={p.key}>
                            {t('subscription.planOption', { name: planName(p, i18n.language), count: p.seats })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quotation-extra-seats">{t('quotation.extraSeats')}</Label>
                <Input
                  id="quotation-extra-seats"
                  type="number"
                  min={0}
                  max={MAX_PLAN_SEATS - (plan?.seats ?? 0)}
                  className="font-mono"
                  aria-invalid={seatsTooFew || !!errors.extraSeats}
                  {...register('extraSeats', {
                    valueAsNumber: true,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                      if (!Number(e.target.value)) setValue('extraSeatPrice', 0, { shouldDirty: true })
                    },
                  })}
                />
              </div>
            </div>

            {(Number(values.extraSeats) || 0) > 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="quotation-seat-price">{t('quotation.extraSeatPrice', { currency })}</Label>
                  <Controller
                    control={control}
                    name="extraSeatPrice"
                    render={({ field }) => (
                      <PriceInput
                        id="quotation-seat-price"
                        className="font-mono"
                        aria-invalid={!!errors.extraSeatPrice}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </div>
                <p className="self-end pb-2 text-xs text-muted-foreground sm:col-span-2">{t('quotation.extraSeatHint')}</p>
              </div>
            )}
            <p className={cn('-mt-2 text-xs', seatsTooFew ? 'text-destructive' : 'text-muted-foreground')}>
              {seatsTooFew
                ? upgrade && company.maxUsers > company.userCount
                  ? t('quotation.seatsBelowCurrent', { count: company.maxUsers })
                  : t('quotation.seatsBelowUsers', { count: company.userCount })
                : t('quotation.seatsTotal', { plan: plan?.seats ?? 0, count: totalSeats })}
            </p>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('quotation.duration')}</span>
              <Controller
                control={control}
                name="months"
                render={({ field }) => (
                  <div role="radiogroup" aria-label={t('quotation.duration')} className="grid grid-cols-4 gap-1 rounded-lg border border-border p-1">
                    {QUOTATION_MONTHS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={field.value === m}
                        onClick={() => {
                          field.onChange(m)
                          if (!upgrade) setValue('endsOn', periodEnd(getValues('startsOn'), m), { shouldDirty: true })
                          reprice({ months: m })
                        }}
                        className={
                          field.value === m
                            ? 'h-8 rounded-md bg-primary text-sm font-medium text-primary-foreground'
                            : 'h-8 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground'
                        }
                      >
                        {t('quotation.months', { count: m })}
                      </button>
                    ))}
                  </div>
                )}
              />
              <p className="text-xs text-muted-foreground">
                {terms
                  ? t(terms.full ? 'quotation.upgradeFull' : 'quotation.upgradeSameEnd', { date: showDay(ctx?.currentEnd) })
                  : values.months === 12
                  ? saving
                    ? t('quotation.annualSaving', { percent: saving })
                    : t('quotation.annual')
                  : t('quotation.monthlyTimes', { count: values.months ?? 1 })}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {upgrade ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t('quotation.startsOn')}</span>
                    <span className="flex h-9 items-center text-sm font-semibold">{showDay(values.startsOn)}</span>
                    <p className="text-xs text-muted-foreground">{t('quotation.upgradeStartHint')}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t('quotation.endsOn')}</span>
                    <span className="flex h-9 items-center text-sm font-semibold">{showDay(values.endsOn)}</span>
                    <p className="text-xs text-muted-foreground">
                      {t(terms?.full ? 'quotation.upgradeEndFullHint' : 'quotation.upgradeEndHint')}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="quotation-start">{t('quotation.startsOn')}</Label>
                    <Input
                      id="quotation-start"
                      type="date"
                      aria-invalid={!!errors.startsOn}
                      {...register('startsOn', {
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                          if (e.target.value) setValue('endsOn', periodEnd(e.target.value, getValues('months')), { shouldDirty: true })
                        },
                      })}
                    />
                    <p className="text-xs text-muted-foreground">{t('quotation.startHint')}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="quotation-end">{t('quotation.endsOn')}</Label>
                    <Input id="quotation-end" type="date" aria-invalid={!!errors.endsOn} {...register('endsOn')} />
                    {error('endsOn') || <p className="text-xs text-muted-foreground">{t('quotation.endHint')}</p>}
                  </div>
                </>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quotation-valid">{t('quotation.validUntil')}</Label>
                <Input id="quotation-valid" type="date" aria-invalid={!!errors.validUntil} {...register('validUntil')} />
                <p className="text-xs text-muted-foreground">{t('quotation.validHint')}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quotation-currency">{t('subscription.currency')}</Label>
                <Controller
                  control={control}
                  name="currency"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        if (!value) return
                        field.onChange(value)
                        setValue('fxRate', null, { shouldDirty: true })
                        reprice({ fxRate: null })
                      }}
                    >
                      <SelectTrigger id="quotation-currency" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BILLING_CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {currency !== 'EGP' && (
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="quotation-rate">{t('quotation.rate', { currency })}</Label>
                  <Controller
                    control={control}
                    name="fxRate"
                    render={({ field }) => (
                      <Input
                        id="quotation-rate"
                        type="number"
                        step="any"
                        min={0}
                        className="font-mono"
                        aria-invalid={!!errors.fxRate}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const rate = e.target.value === '' ? null : Number(e.target.value)
                          field.onChange(rate)
                          reprice({ fxRate: rate })
                        }}
                      />
                    )}
                  />
                  <p className={errors.fxRate ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                    {errors.fxRate
                      ? t('quotation.errors.fxRate')
                      : quote?.source === 'today'
                        ? t('quotation.rateToday')
                        : quote?.source === 'last_known'
                          ? t('quotation.rateLastKnown', { date: quote.date })
                          : fx.isPending
                            ? t('quotation.rateLoading')
                            : t('quotation.rateNone')}
                  </p>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quotation-price">{t('quotation.price', { currency })}</Label>
                <Controller
                  control={control}
                  name="unitPrice"
                  render={({ field }) => (
                    <PriceInput
                      id="quotation-price"
                      className="font-mono"
                      aria-invalid={!!errors.unitPrice}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  {t(terms ? (terms.full ? 'quotation.priceUpgradeFull' : 'quotation.priceUpgrade') : 'quotation.priceHint')}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quotation-discount">{t('quotation.discount')}</Label>
                <div className="flex gap-1.5">
                  <Controller
                    control={control}
                    name="discountKind"
                    render={({ field }) => (
                      <Select
                        value={field.value ?? 'none'}
                        onValueChange={(value) => {
                          if (!value) return
                          const kind = value === 'none' ? null : (value as (typeof DISCOUNT_KINDS)[number])
                          field.onChange(kind)
                          setValue('discountValue', kind ? (getValues('discountValue') ?? 0) : null, { shouldDirty: true })
                        }}
                      >
                        <SelectTrigger className="w-24 shrink-0" aria-label={t('quotation.discountKind')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('quotation.discountNone')}</SelectItem>
                          <SelectItem value="percent">%</SelectItem>
                          <SelectItem value="amount">{currency}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {values.discountKind && (
                    <Controller
                      control={control}
                      name="discountValue"
                      render={({ field }) => (
                        <PriceInput
                          id="quotation-discount"
                          className="font-mono"
                          aria-invalid={!!errors.discountValue}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                        />
                      )}
                    />
                  )}
                </div>
                {error('discountValue')}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quotation-vat">{t('quotation.vat')}</Label>
                <Input
                  id="quotation-vat"
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  className="font-mono"
                  aria-invalid={!!errors.vatRate}
                  {...register('vatRate', { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">{t('quotation.vatHint', { rate: company.vatRate })}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quotation-note">{t('quotation.note')}</Label>
              <Textarea
                id="quotation-note"
                rows={2}
                {...register('note', { setValueAs: (v: string) => (v?.trim() ? v.trim() : null) })}
              />
            </div>

            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              {totals.extraSeatsAmount > 0 && (
                <>
                  <dt className="text-muted-foreground">{t('quotation.totals.plan')}</dt>
                  <dd className="text-end font-mono">{money.format(Number(values.unitPrice) || 0)}</dd>
                  <dt className="text-muted-foreground">
                    {t('quotation.totals.extraSeats', { count: Number(values.extraSeats) || 0 })}
                  </dt>
                  <dd className="text-end font-mono">{money.format(totals.extraSeatsAmount)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t('quotation.totals.subtotal')}</dt>
              <dd className="text-end font-mono">{money.format(totals.subtotal)}</dd>
              {totals.discountAmount > 0 && (
                <>
                  <dt className="text-muted-foreground">{t('quotation.totals.discount')}</dt>
                  <dd className="text-end font-mono">−{money.format(totals.discountAmount)}</dd>
                </>
              )}
              {totals.creditAmount > 0 && (
                <>
                  <dt className="text-muted-foreground">
                    {t('quotation.totals.credit')}
                    <span className="block text-xs">
                      {credit
                        .map((line) => t('quotation.totals.creditLine', { number: line.invoiceNumber, left: line.daysLeft, days: line.days }))
                        .join(' · ')}
                    </span>
                  </dt>
                  <dd className="text-end font-mono text-emerald-600 dark:text-emerald-500">−{money.format(totals.creditAmount)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t('quotation.totals.vat', { rate: Number(values.vatRate) || 0 })}</dt>
              <dd className="text-end font-mono">{money.format(totals.vatAmount)}</dd>
              <dt className="font-semibold">{t('quotation.totals.total')}</dt>
              <dd className="text-end font-mono font-semibold">{money.format(totals.total)}</dd>
              {currency !== 'EGP' && (
                <>
                  <dt className="text-xs text-muted-foreground">{t('quotation.totals.inEgp')}</dt>
                  <dd className="text-end font-mono text-xs text-muted-foreground">{egp.format(totals.totalEgp)}</dd>
                </>
              )}
            </dl>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('quotation.cancel')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending || seatsTooFew}
                onClick={() => void handleSubmit(submit('email'))()}
              >
                {t('quotation.next')}
                <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
              </Button>
              <Button type="submit" disabled={save.isPending || seatsTooFew}>
                <Check aria-hidden="true" />
                {t('quotation.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
