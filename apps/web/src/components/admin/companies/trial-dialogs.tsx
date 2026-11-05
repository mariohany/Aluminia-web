import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Info, Plus, X } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import type { CompanyDetail } from '@repo/types/companies'
import { PAID_PLAN_KEYS, type PaidPlanKey } from '@repo/types/plans'
import {
  BILLING_TIME_ZONE,
  MAX_TRIAL_DAYS,
  TRIAL_DEFAULT_DAYS,
  addDays,
  cairoDateOf,
  daysBetween,
  endOfCairoDay,
  latestTrialEnd,
} from '@repo/types/subscriptions'
import { apiErrorMessage } from '@/lib/api-client'
import { planName } from '@/lib/bilingual'
import { useEndTrialMutation, useExtendTrialMutation, useGrantTrialMutation } from '@/lib/companies-queries'
import { usePlansQuery } from '@/lib/plans-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Trials (docs/payment_cycle_planing.md P2, P20, P26; boards
// `pc-dlg-grant`, `pc-dlg-extend`, `pc-dlg-end`): only the days are typed,
// the end date is worked out and shown as text. No quotation, invoice or
// payment is ever made.

interface TrialDialogProps {
  company: CompanyDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}

type TrialForm = (props: Omit<TrialDialogProps, 'open'>) => ReactNode

// The form mounts only while the dialog is open, so it starts fresh each time.
function TrialShell({
  company,
  open,
  onOpenChange,
  width,
  Form,
}: TrialDialogProps & { width: string; Form: TrialForm }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={width}>{open && <Form company={company} onOpenChange={onOpenChange} />}</DialogContent>
    </Dialog>
  )
}

/** A whole number of days from 1 to MAX_TRIAL_DAYS, or null. */
function parseDays(text: string): number | null {
  const days = Number(text)
  return text.trim() !== '' && Number.isInteger(days) && days >= 1 && days <= MAX_TRIAL_DAYS ? days : null
}

function useEndFormatter() {
  const { i18n } = useTranslation('admin')
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: BILLING_TIME_ZONE })
  return (date: string) => format.format(endOfCairoDay(date))
}

/** A worked-out date: plain text, not an input. */
function Shown({ label, value, caption }: { label: string; value: string; caption: ReactNode }) {
  const { t } = useTranslation('admin')
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className="text-[15px] font-semibold text-foreground">
        {value} <span className="text-xs font-normal text-muted-foreground">· {t('subscription.endOfDay')}</span>
      </span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </div>
  )
}

function DaysInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid: boolean
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={MAX_TRIAL_DAYS}
      className="font-mono"
      aria-invalid={invalid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function GrantTrialForm({ company, onOpenChange }: Omit<TrialDialogProps, 'open'>) {
  const { t, i18n } = useTranslation('admin')
  const { data: plans } = usePlansQuery()
  const mutation = useGrantTrialMutation(company.id)
  const formatEnd = useEndFormatter()
  const [planKey, setPlanKey] = useState<PaidPlanKey>('pro')
  const [daysText, setDaysText] = useState(String(TRIAL_DEFAULT_DAYS))

  const paidPlans = (plans ?? []).filter((p) => (PAID_PLAN_KEYS as readonly string[]).includes(p.key))
  const plan = paidPlans.find((p) => p.key === planKey)
  const days = parseDays(daysText)
  const paused = company.users.filter((user) => user.planDeactivated).length
  // P20: the trial uses the plan's own seats, so every user must fit.
  const tooFewSeats = !!plan && company.userCount > plan.seats

  async function onSubmit() {
    if (days === null || tooFewSeats) return
    try {
      await mutation.mutateAsync({ planKey, days })
      toast.success(t('trial.granted'))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('trial.error')))
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('trial.grantTitle')}</DialogTitle>
        <DialogDescription>{t('trial.onFree', { name: company.name })}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trial-plan">{t('subscription.plan')}</Label>
          <Select value={planKey} onValueChange={(value) => value && setPlanKey(value as PaidPlanKey)}>
            <SelectTrigger id="trial-plan" className="w-full">
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trial-days">{t('trial.days')}</Label>
          <DaysInput id="trial-days" value={daysText} onChange={setDaysText} invalid={days === null} />
          <p className={days === null ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {t('trial.daysHint', { max: MAX_TRIAL_DAYS })}
          </p>
        </div>
      </div>

      <Shown
        label={t('trial.ends')}
        value={days === null ? '—' : formatEnd(addDays(cairoDateOf(new Date()), days))}
        caption={t('trial.endsHint')}
      />

      {tooFewSeats ? (
        <p className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('trial.tooFewSeats', { count: company.userCount, seats: plan.seats, plan: planName(plan, i18n.language) })}
        </p>
      ) : (
        <p className="flex gap-2 rounded-lg bg-muted/60 p-3 text-[13px] text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t(paused > 0 ? 'trial.grantNotePaused' : 'trial.grantNote', {
            count: paused,
            seats: plan?.seats ?? '—',
            plan: plan ? planName(plan, i18n.language) : '',
          })}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t('subscription.cancel')}
        </Button>
        <Button type="submit" disabled={days === null || tooFewSeats || !plan || mutation.isPending}>
          <Check aria-hidden="true" />
          {t('trial.grant')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function ExtendTrialForm({ company, onOpenChange }: Omit<TrialDialogProps, 'open'>) {
  const { t, i18n } = useTranslation('admin')
  const mutation = useExtendTrialMutation(company.id)
  const formatEnd = useEndFormatter()
  const [daysText, setDaysText] = useState('7')

  const today = cairoDateOf(new Date())
  const currentEnd = company.endsAt ? cairoDateOf(new Date(company.endsAt)) : today
  const daysLeft = Math.max(0, daysBetween(today, currentEnd))
  const days = parseDays(daysText)
  const newEnd = days === null ? null : addDays(currentEnd, days)
  const latest = latestTrialEnd(new Date())
  const tooLong = newEnd !== null && newEnd > latest
  const latestText = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeZone: BILLING_TIME_ZONE,
  }).format(endOfCairoDay(latest))

  async function onSubmit() {
    if (days === null || tooLong) return
    try {
      await mutation.mutateAsync({ days })
      toast.success(t('trial.extended'))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('trial.error')))
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('trial.extendTitle')}</DialogTitle>
        <DialogDescription>
          {t('trial.onTrial', { name: company.name, plan: planName(company.plan, i18n.language) })}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Shown
          label={t('trial.currentEnd')}
          value={formatEnd(currentEnd)}
          caption={t('trial.daysLeft', { count: daysLeft })}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trial-add-days">{t('trial.addDays')}</Label>
          <DaysInput id="trial-add-days" value={daysText} onChange={setDaysText} invalid={days === null || tooLong} />
        </div>
      </div>

      <Shown
        label={t('trial.newEnd')}
        value={newEnd === null ? '—' : formatEnd(newEnd)}
        caption={
          tooLong ? (
            <span className="text-destructive">{t('trial.tooLong', { date: latestText, max: MAX_TRIAL_DAYS })}</span>
          ) : (
            t('trial.newEndHint', { date: latestText })
          )
        }
      />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t('subscription.cancel')}
        </Button>
        <Button type="submit" disabled={days === null || tooLong || mutation.isPending}>
          <Plus aria-hidden="true" />
          {t('trial.extend')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function EndTrialForm({ company, onOpenChange }: Omit<TrialDialogProps, 'open'>) {
  const { t, i18n } = useTranslation('admin')
  const mutation = useEndTrialMutation(company.id)
  const [reason, setReason] = useState('')

  // Same pick as the API's drop to Free: the oldest active admin, else the
  // oldest active user, stays.
  const active = company.users
    .filter((user) => user.status === 'active')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const keep = active.find((user) => user.role === UserRole.COMPANY_ADMIN) ?? active[0]
  const paused = active.length - (keep ? 1 : 0)
  const daysLeft = company.endsAt
    ? Math.max(0, daysBetween(cairoDateOf(new Date()), cairoDateOf(new Date(company.endsAt))))
    : 0

  async function onSubmit() {
    try {
      await mutation.mutateAsync({ reason: reason.trim() || null })
      toast.success(t('trial.ended'))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('trial.error')))
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('trial.endTitle')}</DialogTitle>
        <DialogDescription>
          {t('trial.onTrial', { name: company.name, plan: planName(company.plan, i18n.language) })}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2 text-[13px] text-foreground">
        <p>{t('trial.endMoves', { name: company.name, count: daysLeft })}</p>
        <ul className="flex list-disc flex-col gap-1 ps-5">
          {keep && <li>{t('trial.endKeeps', { email: keep.email })}</li>}
          {paused > 0 && <li>{t('trial.endPauses', { count: paused })}</li>}
          <li>{t('trial.endProjects')}</li>
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="trial-end-reason">{t('trial.reasonOptional')}</Label>
        <Input
          id="trial-end-reason"
          maxLength={300}
          value={reason}
          placeholder={t('trial.reasonPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t('subscription.cancel')}
        </Button>
        <Button type="submit" variant="destructive" disabled={mutation.isPending}>
          <X aria-hidden="true" />
          {t('trial.end')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function GrantTrialDialog(props: TrialDialogProps) {
  return <TrialShell {...props} width="sm:max-w-lg" Form={GrantTrialForm} />
}

export function ExtendTrialDialog(props: TrialDialogProps) {
  return <TrialShell {...props} width="sm:max-w-lg" Form={ExtendTrialForm} />
}

export function EndTrialDialog(props: TrialDialogProps) {
  return <TrialShell {...props} width="sm:max-w-md" Form={EndTrialForm} />
}
