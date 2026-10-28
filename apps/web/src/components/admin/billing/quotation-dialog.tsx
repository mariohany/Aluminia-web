import { useEffect, useRef, useState } from 'react'
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
  type BillingDocumentSummary,
  type QuotationInput,
  type QuotationMonths,
} from '@repo/types/billing-documents'
import { MAX_PLAN_SEATS, PAID_PLAN_KEYS, type PlanSummary } from '@repo/types/plans'
import { BILLING_CURRENCIES, addDays, cairoDateOf, type BillingCurrency } from '@repo/types/subscriptions'
import { apiErrorCode, apiErrorMessage } from '@/lib/api-client'
import { planName } from '@/lib/bilingual'
import { useFxQuoteQuery, useSaveQuotationMutation, useSendDefaultsQuery } from '@/lib/billing-queries'
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

function blankForm(company: CompanyDetail, plans: PlanSummary[] | undefined, today: string): QuotationInput {
  const planKey = PAID_PLAN_KEYS.find((key) => key === company.plan.key) ?? 'pro'
  const startsOn = renewalStart(company, today)
  const currency = company.currency
  const plan = plans?.find((p) => p.key === planKey)
  return {
    planKey,
    seats: Math.max(company.plan.key === 'free' ? (plan?.seats ?? 1) : company.maxUsers, company.userCount),
    months: 12,
    startsOn,
    endsOn: periodEnd(startsOn, 12),
    currency,
    fxRate: null,
    unitPrice: currency === 'EGP' ? priceOf(plans, planKey, 12, null) : 0,
    discountKind: null,
    discountValue: null,
    vatRate: company.vatRate,
    validUntil: addDays(today, QUOTATION_VALID_DAYS),
    note: null,
  }
}

function fromDocument(doc: BillingDocumentSummary): QuotationInput {
  return {
    planKey: doc.plan.key as QuotationInput['planKey'],
    seats: doc.seats,
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
 * `bill-q-new`), step 1: plan, seats, duration (1/3/6/12 months; 12 = the
 * annual price), dates (B8 start, editable end), currency at today's rate
 * (frozen on the quotation), price (overwritable), discount, VAT % and
 * valid until (14 days, Q3). Step 2 emails it (B16, B18): Next saves the
 * draft and opens the Email step; Back edits that same draft. Also edits a
 * draft (`document`).
 */
export function QuotationDialog({
  company,
  document,
  open,
  onOpenChange,
}: {
  company: CompanyDetail
  document?: BillingDocumentSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation('admin')
  const { data: plans } = usePlansQuery()
  const save = useSaveQuotationMutation(company.id)
  const today = cairoDateOf(new Date())
  const paidPlans = (plans ?? []).filter((p) => p.key !== 'free')
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
  useEffect(() => {
    if (!open || filled.current || !plans) return
    filled.current = true
    reset(document ? fromDocument(document) : blankForm(company, plans, today))
  }, [open, document, company, plans, today, reset])

  const values = useWatch({ control }) as Partial<QuotationInput>
  const currency = (values.currency ?? company.currency) as BillingCurrency
  const fx = useFxQuoteQuery(currency, open)

  // Today's rate prefills an empty rate field (and the price with it).
  const quote = fx.data
  useEffect(() => {
    if (!quote?.egpPerUnit || quote.currency !== getValues('currency') || getValues('fxRate')) return
    setValue('fxRate', quote.egpPerUnit)
    setValue('unitPrice', priceOf(plans, getValues('planKey'), getValues('months'), quote.egpPerUnit))
  }, [quote, plans, getValues, setValue])

  /** Plan, months or rate changed: the plan's price again. */
  function reprice(next: Partial<Pick<QuotationInput, 'planKey' | 'months' | 'fxRate'>>) {
    const v = { ...getValues(), ...next }
    setValue('unitPrice', priceOf(plans, v.planKey, v.months, v.currency === 'EGP' ? null : v.fxRate), {
      shouldDirty: true,
    })
  }

  const totals = documentTotals({
    unitPrice: Number(values.unitPrice) || 0,
    discountKind: values.discountKind ?? null,
    discountValue: values.discountValue ?? null,
    vatRate: Number(values.vatRate) || 0,
    fxRate: values.fxRate ?? null,
  })
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency, minimumFractionDigits: 2 })
  const egp = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EGP', minimumFractionDigits: 2 })
  const plan = plans?.find((p) => p.key === values.planKey)
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
            {saved
              ? t('email.title', { number: saved.number })
              : document
                ? t('quotation.editTitle', { number: document.number })
                : t('quotation.title')}
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
                        const next = plans?.find((p) => p.key === value)
                        if (next) setValue('seats', Math.max(next.seats, company.userCount), { shouldDirty: true })
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
                <Label htmlFor="quotation-seats">{t('quotation.seats')}</Label>
                <Input
                  id="quotation-seats"
                  type="number"
                  min={company.userCount}
                  max={MAX_PLAN_SEATS}
                  className="font-mono"
                  aria-invalid={!!errors.seats}
                  {...register('seats', { valueAsNumber: true })}
                />
                {(values.seats ?? 0) < company.userCount ? (
                  <p className="text-xs text-destructive">{t('quotation.seatsBelowUsers', { count: company.userCount })}</p>
                ) : (
                  error('seats')
                )}
              </div>
            </div>

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
                          setValue('endsOn', periodEnd(getValues('startsOn'), m), { shouldDirty: true })
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
                {values.months === 12
                  ? saving
                    ? t('quotation.annualSaving', { percent: saving })
                    : t('quotation.annual')
                  : t('quotation.monthlyTimes', { count: values.months ?? 1 })}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
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
                <p className="text-xs text-muted-foreground">{t('quotation.priceHint')}</p>
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
              <dt className="text-muted-foreground">{t('quotation.totals.subtotal')}</dt>
              <dd className="text-end font-mono">{money.format(totals.subtotal)}</dd>
              {totals.discountAmount > 0 && (
                <>
                  <dt className="text-muted-foreground">{t('quotation.totals.discount')}</dt>
                  <dd className="text-end font-mono">−{money.format(totals.discountAmount)}</dd>
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
                disabled={save.isPending || (values.seats ?? 0) < company.userCount}
                onClick={() => void handleSubmit(submit('email'))()}
              >
                {t('quotation.next')}
                <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
              </Button>
              <Button type="submit" disabled={save.isPending || (values.seats ?? 0) < company.userCount}>
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
