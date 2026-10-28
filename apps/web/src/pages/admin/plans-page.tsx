import { useEffect } from 'react'
import { Controller, useForm, useWatch, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import {
  MAX_PLAN_SEATS,
  PAID_PLAN_KEYS,
  PLAN_FEATURES,
  annualSavingPercent,
  updatePlansSchema,
  type PaidPlanInput,
  type PlanSummary,
  type UpdatePlansInput,
} from '@repo/types/plans'
import { apiErrorMessage } from '@/lib/api-client'
import { usePlansQuery, useUpdatePlansMutation } from '@/lib/plans-queries'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PriceInput } from '@/components/ui/price-input'
import { Skeleton } from '@/components/ui/skeleton'

function toForm(plans: PlanSummary[]): UpdatePlansInput {
  return {
    plans: PAID_PLAN_KEYS.map((key) => {
      const plan = plans.find((p) => p.key === key)
      return {
        key,
        nameEn: plan?.nameEn ?? '',
        nameAr: plan?.nameAr ?? '',
        seats: plan?.seats ?? 1,
        monthlyEgp: plan?.monthlyEgp ?? Number.NaN,
        annualEgp: plan?.annualEgp ?? Number.NaN,
        features: plan?.features ?? [],
      }
    }),
  }
}

/**
 * Admin › Billing › Plans (docs/subscriptions_planing.md B1, board
 * `bill-plans-a`): a column per paid plan, one Save for all. Free is
 * fixed in code, so it's only a note here.
 */
export function PlansPage() {
  const { t } = useTranslation('admin')
  const { data: plans, isPending, isError } = usePlansQuery()
  const update = useUpdatePlansMutation()

  const {
    control,
    register,
    reset,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<UpdatePlansInput>({
    resolver: zodResolver(updatePlansSchema),
    defaultValues: { plans: [] },
  })

  useEffect(() => {
    if (plans) reset(toForm(plans))
  }, [plans, reset])

  async function onSubmit(values: UpdatePlansInput) {
    try {
      const saved = await update.mutateAsync(values)
      reset(toForm(saved))
      toast.success(t('plansPage.saved'))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('plansPage.saveError')))
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('plansPage.title')}</h1>
          <p className="max-w-3xl text-[13px] text-muted-foreground">{t('plansPage.subtitle')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!isDirty || update.isPending}
          onClick={() => plans && reset(toForm(plans))}
        >
          {t('plansPage.discard')}
        </Button>
        <Button type="submit" disabled={!isDirty || update.isPending}>
          <Check aria-hidden="true" />
          {t('plansPage.save')}
        </Button>
      </div>

      <p className="text-[12.5px] text-muted-foreground">{t('plansPage.free')}</p>

      {isError ? (
        <p className="py-6 text-center text-sm text-destructive">{t('plansPage.loadError')}</p>
      ) : isPending ? (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {PAID_PLAN_KEYS.map((key) => (
            <Skeleton key={key} className="h-[520px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {PAID_PLAN_KEYS.map((key, index) => (
            <PlanColumn key={key} index={index} control={control} register={register} errors={errors} />
          ))}
        </div>
      )}
    </form>
  )
}

function PlanColumn({
  index,
  control,
  register,
  errors,
}: {
  index: number
  control: Control<UpdatePlansInput>
  register: UseFormRegister<UpdatePlansInput>
  errors: FieldErrors<UpdatePlansInput>
}) {
  const { t } = useTranslation('admin')
  const plan = useWatch({ control, name: `plans.${index}` }) as PaidPlanInput | undefined
  const fieldErrors = errors.plans?.[index]
  const id = (field: string) => `plan-${index}-${field}`

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[17px] font-semibold text-foreground">{plan?.nameEn || '—'}</span>
          <span dir="rtl" className="text-start text-[13px] text-muted-foreground">
            {plan?.nameAr || '—'}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={id('nameEn')} label={t('plansPage.nameEn')} error={fieldErrors?.nameEn && t('plansPage.errors.required')}>
            <Input id={id('nameEn')} aria-invalid={!!fieldErrors?.nameEn} {...register(`plans.${index}.nameEn`)} />
          </Field>
          <Field id={id('nameAr')} label={t('plansPage.nameAr')} error={fieldErrors?.nameAr && t('plansPage.errors.required')}>
            <Input id={id('nameAr')} dir="rtl" aria-invalid={!!fieldErrors?.nameAr} {...register(`plans.${index}.nameAr`)} />
          </Field>
        </div>

        <Field
          id={id('seats')}
          label={t('plansPage.seats')}
          hint={t('plansPage.seatsHint')}
          error={fieldErrors?.seats && t('plansPage.errors.seats', { max: MAX_PLAN_SEATS })}
        >
          <Input
            id={id('seats')}
            type="number"
            min={1}
            max={MAX_PLAN_SEATS}
            className="w-24 font-mono"
            aria-invalid={!!fieldErrors?.seats}
            {...register(`plans.${index}.seats`, { valueAsNumber: true })}
          />
        </Field>

        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <span className="text-xs font-medium text-foreground">{t('plansPage.price')}</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id={id('monthly')}
              label={t('plansPage.monthly')}
              hint={t('plansPage.monthlyHint')}
              error={fieldErrors?.monthlyEgp && t('plansPage.errors.price')}
            >
              <SuffixBox suffix={t('plansPage.monthlySuffix')}>
                <Controller
                  control={control}
                  name={`plans.${index}.monthlyEgp`}
                  render={({ field }) => (
                    <PriceInput
                      id={id('monthly')}
                      className="pe-20 font-mono"
                      aria-invalid={!!fieldErrors?.monthlyEgp}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </SuffixBox>
            </Field>
            <Field
              id={id('annual')}
              label={t('plansPage.annual')}
              hint={<AnnualHint monthly={plan?.monthlyEgp} annual={plan?.annualEgp} />}
              error={fieldErrors?.annualEgp && t('plansPage.errors.price')}
            >
              <SuffixBox suffix={t('plansPage.annualSuffix')}>
                <Controller
                  control={control}
                  name={`plans.${index}.annualEgp`}
                  render={({ field }) => (
                    <PriceInput
                      id={id('annual')}
                      className="pe-20 font-mono"
                      aria-invalid={!!fieldErrors?.annualEgp}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </SuffixBox>
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border pt-3">
          <span className="text-xs font-medium text-foreground">{t('plansPage.features')}</span>
          <Controller
            control={control}
            name={`plans.${index}.features`}
            render={({ field }) => (
              <>
                {PLAN_FEATURES.map((feature) => {
                  const on = field.value?.includes(feature) ?? false
                  return (
                    <label key={feature} className="flex items-center gap-2.5 text-[13px] text-foreground">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? PLAN_FEATURES.filter((f) => f === feature || field.value?.includes(f))
                              : (field.value ?? []).filter((f) => f !== feature),
                          )
                        }
                      />
                      {t(`plansPage.featureNames.${feature}`)}
                    </label>
                  )
                })}
              </>
            )}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function AnnualHint({ monthly, annual }: { monthly: number | undefined; annual: number | undefined }) {
  const { t, i18n } = useTranslation('admin')
  if (!(typeof monthly === 'number' && monthly > 0 && typeof annual === 'number' && annual > 0)) return null
  const percent = annualSavingPercent(monthly, annual)
  if (percent > 0) {
    return <>{t('plansPage.annualSaves', { percent: new Intl.NumberFormat(i18n.language).format(percent) })}</>
  }
  return <>{percent < 0 ? t('plansPage.annualDearer') : t('plansPage.annualSame')}</>
}

function SuffixBox({ suffix, children }: { suffix: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">
        {suffix}
      </span>
    </div>
  )
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: React.ReactNode
  error?: string | false
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
