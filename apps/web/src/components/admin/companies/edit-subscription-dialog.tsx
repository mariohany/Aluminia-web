import { useEffect, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Info, TriangleAlert } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import type { CompanyDetail } from '@repo/types/companies'
import { MAX_PLAN_SEATS } from '@repo/types/plans'
import { cairoDateOf, updateSubscriptionSchema, type UpdateSubscriptionInput } from '@repo/types/subscriptions'
import { apiErrorMessage } from '@/lib/api-client'
import { planName } from '@/lib/bilingual'
import { useUpdateSubscriptionMutation } from '@/lib/companies-queries'
import { usePlansQuery } from '@/lib/plans-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredMark } from '@/components/ui/required-mark'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function toForm(company: CompanyDetail, keepAdminId: string | null): UpdateSubscriptionInput {
  return {
    planKey: company.plan.key,
    maxUsers: company.maxUsers,
    endDate: company.endsAt ? cairoDateOf(new Date(company.endsAt)) : null,
    reason: '',
    keepAdminId,
  }
}

/**
 * Edit subscription, the special case (docs/payment_cycle_planing.md P27,
 * board `pc-dlg-special`): plan, seat limit and end date for a gift or a
 * wrong date, with a required reason for the history. No invoice is made;
 * trials have their own actions and currency / VAT are set on quotations.
 * Free is one seat: the super admin picks the admin who stays, the others
 * are deactivated (B13); a paid plan after Free brings exactly those back
 * (B14).
 */
export function EditSubscriptionDialog({
  company,
  open,
  onOpenChange,
}: {
  company: CompanyDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation('admin')
  const { data: plans } = usePlansQuery()
  const mutation = useUpdateSubscriptionMutation(company.id)

  // Who can stay on Free: an admin who is active, or one the drop to Free
  // deactivated (swapping back). Oldest first, as the API defaults.
  const admins = useMemo(
    () =>
      company.users.filter(
        (user) => user.role === UserRole.COMPANY_ADMIN && (user.status === 'active' || user.planDeactivated),
      ),
    [company.users],
  )
  const defaultKeep = admins.find((user) => user.status === 'active')?.id ?? admins[0]?.id ?? null

  const {
    control,
    register,
    reset,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateSubscriptionInput>({
    resolver: zodResolver(updateSubscriptionSchema),
    defaultValues: toForm(company, defaultKeep),
  })

  useEffect(() => {
    if (open) reset(toForm(company, defaultKeep))
  }, [open, company, defaultKeep, reset])

  const [planKey, maxUsers, keepAdminId] = useWatch({
    control,
    name: ['planKey', 'maxUsers', 'keepAdminId'],
  })
  // Only Grant trial starts a trial; editing one keeps it a trial.
  const isTrial = company.isTrial && planKey !== 'free'
  const free = planKey === 'free'
  const wasFree = company.plan.key === 'free'
  const plan = plans?.find((p) => p.key === planKey)

  // Same rule as the API (B3): never below the users, checked when the
  // limit goes down or Free ends (everyone it deactivated comes back).
  const belowUsers =
    !free &&
    Number.isFinite(maxUsers) &&
    maxUsers < company.userCount &&
    (maxUsers < company.maxUsers || wasFree)
  const othersActive = company.users.filter((user) => user.status === 'active' && user.id !== keepAdminId).length

  async function onSubmit(values: UpdateSubscriptionInput) {
    try {
      await mutation.mutateAsync({
        ...values,
        endDate: free ? null : values.endDate,
        reason: values.reason.trim(),
      })
      toast.success(t('subscription.saved'))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('subscription.saveError')))
    }
  }

  const dateId = 'subscription-ends'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('subscription.specialTitle')}</DialogTitle>
            <DialogDescription>{t('subscription.specialDescription', { name: company.name })}</DialogDescription>
          </DialogHeader>

          <p className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-[13px] text-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden="true" />
            {t('subscription.specialWarning')}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subscription-plan">{t('subscription.plan')}</Label>
              <Controller
                control={control}
                name="planKey"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      if (!value) return
                      const next = plans?.find((p) => p.key === value)
                      field.onChange(value)
                      if (next && next.key !== 'free') setValue('maxUsers', next.seats, { shouldDirty: true })
                    }}
                  >
                    <SelectTrigger id="subscription-plan" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(plans ?? []).map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {t('subscription.planOption', { name: planName(p, i18n.language), count: p.seats })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {!free && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subscription-seats">{t('subscription.seats')}</Label>
                <Input
                  id="subscription-seats"
                  type="number"
                  min={1}
                  max={MAX_PLAN_SEATS}
                  className="font-mono"
                  aria-invalid={belowUsers || !!errors.maxUsers}
                  {...register('maxUsers', { valueAsNumber: true })}
                />
                {belowUsers ? (
                  <p className="text-xs text-destructive">
                    {t('subscription.seatsBelowUsers', {
                      count: company.userCount,
                      remove: company.userCount - maxUsers,
                      max: maxUsers,
                    })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('subscription.seatsHint', { seats: plan?.seats ?? '—', count: company.userCount })}
                  </p>
                )}
              </div>
            )}
          </div>

          {free ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <p className="flex gap-2 text-[13px] text-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {othersActive > 0
                  ? t('subscription.freeDeactivates', { count: othersActive })
                  : t('subscription.freeFixed')}
              </p>
              {admins.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="subscription-keep">{t('subscription.keepAdmin')}</Label>
                  <Controller
                    control={control}
                    name="keepAdminId"
                    render={({ field }) => (
                      <Select value={field.value ?? undefined} onValueChange={(value) => value && field.onChange(value)}>
                        <SelectTrigger id="subscription-keep" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {admins.map((admin) => (
                            <SelectItem key={admin.id} value={admin.id}>
                              {admin.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={dateId}>{t(isTrial ? 'subscription.trialEnds' : 'subscription.ends')}</Label>
              <Controller
                control={control}
                name="endDate"
                render={({ field }) => (
                  <div className="relative">
                    <Input
                      id={dateId}
                      type="date"
                      className="pe-24 font-mono"
                      aria-invalid={!!errors.endDate}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                      onBlur={field.onBlur}
                    />
                    <span className="pointer-events-none absolute inset-y-0 end-9 flex items-center text-xs text-muted-foreground">
                      {t('subscription.endOfDay')}
                    </span>
                  </div>
                )}
              />
              {errors.endDate ? (
                <p className="text-xs text-destructive">{t('subscription.endRequired')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t(isTrial ? 'subscription.trialEndsHint' : 'subscription.endsHint')}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subscription-reason">
              {t('subscription.reason')} <RequiredMark />
            </Label>
            <Input
              id="subscription-reason"
              maxLength={300}
              aria-invalid={!!errors.reason}
              placeholder={t('subscription.reasonPlaceholder')}
              {...register('reason')}
            />
            <p className={errors.reason ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {t(errors.reason ? 'subscription.reasonRequired' : 'subscription.reasonHint')}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('subscription.cancel')}
            </Button>
            <Button type="submit" disabled={!isDirty || isSubmitting || belowUsers}>
              <Check aria-hidden="true" />
              {t('subscription.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
