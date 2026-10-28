import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import {
  PAYMENT_METHODS,
  markPaidSchema,
  type BillingDocumentSummary,
  type MarkPaidInput,
} from '@repo/types/billing-documents'
import { cairoDateOf } from '@repo/types/subscriptions'
import { apiErrorCode, apiErrorMessage } from '@/lib/api-client'
import { planName } from '@/lib/bilingual'
import { useMarkPaidMutation } from '@/lib/billing-queries'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PriceInput } from '@/components/ui/price-input'
import { RequiredMark } from '@/components/ui/required-mark'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * Mark paid (docs/subscriptions_planing.md B4, boards `bill-q-paid`,
 * `bill-tx-paid`): the money arrived outside the app, so every field is
 * required, the transaction reference too (it prints on the invoice). On
 * confirm the invoice is created and the company renewed (B8); "Email the
 * invoice now" hands the invoice to `onEmail` (the email step alone).
 */
export function MarkPaidDialog({
  document,
  onOpenChange,
  onEmail,
}: {
  document: BillingDocumentSummary | null
  onOpenChange: (open: boolean) => void
  onEmail?: (invoice: BillingDocumentSummary) => void
}) {
  const { t, i18n } = useTranslation('admin')
  const pay = useMarkPaidMutation()
  const [emailNow, setEmailNow] = useState(true)
  const {
    control,
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<MarkPaidInput>({ resolver: zodResolver(markPaidSchema) })

  useEffect(() => {
    if (document) {
      reset({
        paidOn: cairoDateOf(new Date()),
        amountReceived: document.totals.total,
        method: 'bank_transfer',
        reference: '',
      })
    }
  }, [document, reset])

  if (!document) return null
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' })
  const day = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`))

  async function onSubmit(input: MarkPaidInput) {
    if (!document) return
    try {
      const invoice = await pay.mutateAsync({ id: document.id, input })
      toast.success(t('markPaid.done', { number: invoice.number }))
      onOpenChange(false)
      if (emailNow && onEmail) onEmail(invoice)
    } catch (err) {
      const code = apiErrorCode(err)
      toast.error(
        code === 'quotation_expired' || code === 'seats_below_users'
          ? t(`markPaid.errors.${code}`)
          : apiErrorMessage(err, t('markPaid.errors.save')),
      )
    }
  }

  const required = (label: string) => (
    <span>
      {label} <RequiredMark />
    </span>
  )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('markPaid.title', { number: document.number })}</DialogTitle>
            <DialogDescription>{t('markPaid.description')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paid-on">{required(t('markPaid.paidOn'))}</Label>
              <Input id="paid-on" type="date" aria-invalid={!!errors.paidOn} {...register('paidOn')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paid-amount">{required(t('markPaid.amount', { currency: document.currency }))}</Label>
              <Controller
                control={control}
                name="amountReceived"
                render={({ field }) => (
                  <PriceInput
                    id="paid-amount"
                    className="font-mono"
                    aria-invalid={!!errors.amountReceived}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paid-method">{required(t('markPaid.method'))}</Label>
              <Controller
                control={control}
                name="method"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                    <SelectTrigger id="paid-method" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {t(`markPaid.methods.${m}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paid-reference">{required(t('markPaid.reference'))}</Label>
              <Input
                id="paid-reference"
                className="font-mono"
                placeholder="SNB-55120931"
                aria-invalid={!!errors.reference}
                {...register('reference')}
              />
              <p className={errors.reference ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {errors.reference ? t('markPaid.errors.reference') : t('markPaid.referenceHint')}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
            <span className="font-medium">{t('markPaid.onConfirm')}</span>
            <span>• {t('markPaid.invoiceCreated')}</span>
            <span>
              •{' '}
              {t('markPaid.renewed', {
                plan: planName(document.plan, i18n.language),
                seats: document.seats,
                start: day(document.startsOn),
                end: day(document.endsOn),
              })}
            </span>
            <span className="text-xs text-muted-foreground">{t('markPaid.startNote')}</span>
          </div>

          {onEmail && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={emailNow} onCheckedChange={(checked) => setEmailNow(checked === true)} />
              {t('markPaid.emailNow')}
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('quotation.cancel')}
            </Button>
            <Button type="submit" disabled={pay.isPending}>
              <Check aria-hidden="true" />
              {t('markPaid.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
