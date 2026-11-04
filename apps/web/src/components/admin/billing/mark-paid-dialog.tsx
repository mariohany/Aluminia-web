import { useEffect, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Loader2, Mail, RotateCw, TriangleAlert } from 'lucide-react'
import {
  PAYMENT_METHODS,
  markPaidSchema,
  round2,
  type BillingDocumentSummary,
  type MarkPaidInput,
} from '@repo/types/billing-documents'
import { cairoDateOf } from '@repo/types/subscriptions'
import { apiErrorCode, apiErrorMessage } from '@/lib/api-client'
import { planName } from '@/lib/bilingual'
import { useMarkPaidMutation, useSendDefaultsQuery, useSendDocumentMutation } from '@/lib/billing-queries'
import { pdfToBase64, useBillingPdf } from '@/lib/billing-pdf'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PriceInput } from '@/components/ui/price-input'
import { RequiredMark } from '@/components/ui/required-mark'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * Record payment (docs/subscriptions_planing.md B4, docs/payment_cycle_planing.md
 * §6, boards `bill-q-paid`, `bill-tx-paid`): the money arrived outside the
 * app, so every field is required, the reference too (it prints on the
 * invoice, once per method). A different amount needs a note (P12); an
 * expired quotation shows a warning and is recorded anyway on confirm
 * (P14). On confirm the invoice is created and the company renewed (B8),
 * then the invoice is emailed by itself to its default recipients (P23);
 * if that fails the dialog says so, with Retry and `onEmail` (the email
 * step alone).
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
  // After the payment: the invoice being emailed (P23), for this quotation.
  const [paid, setPaid] = useState<{ quotationId: string; invoice: BillingDocumentSummary } | null>(null)
  const {
    control,
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<MarkPaidInput>({ resolver: zodResolver(markPaidSchema) })
  const [amountReceived, note] = useWatch({ control, name: ['amountReceived', 'note'] })

  useEffect(() => {
    if (document) {
      reset({
        paidOn: cairoDateOf(new Date()),
        amountReceived: document.totals.total,
        method: 'bank_transfer',
        reference: '',
        note: null,
      })
    }
  }, [document, reset])

  if (!document) return null
  const invoice = paid?.quotationId === document.id ? paid.invoice : null
  if (invoice) {
    return (
      <InvoiceMailer
        invoice={invoice}
        onClose={() => onOpenChange(false)}
        onEmail={
          onEmail
            ? () => {
                onOpenChange(false)
                onEmail(invoice)
              }
            : undefined
        }
      />
    )
  }
  const expired = document.status === 'expired'
  const received = Number(amountReceived)
  const difference = Number.isFinite(received) ? round2(received - document.totals.total) : 0
  const noteRequired = difference !== 0
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: document.currency })
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' })
  const day = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`))

  async function onSubmit(input: MarkPaidInput) {
    if (!document) return
    try {
      if (noteRequired && !input.note?.trim()) return
      const created = await pay.mutateAsync({
        id: document.id,
        input: { ...input, note: input.note?.trim() || null, acknowledgeExpired: expired },
      })
      toast.success(t('markPaid.done', { number: created.number }))
      setPaid({ quotationId: document.id, invoice: created })
    } catch (err) {
      const code = apiErrorCode(err)
      toast.error(
        code && KNOWN_ERRORS.includes(code) ? t(`markPaid.errors.${code}`) : apiErrorMessage(err, t('markPaid.errors.save')),
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

          {expired && (
            <p role="alert" className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-[13px] text-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden="true" />
              {t('markPaid.expiredWarning', { date: document.validUntil ? day(document.validUntil) : '—' })}
            </p>
          )}

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
              <p className={noteRequired ? 'text-xs text-amber-600 dark:text-amber-500' : 'text-xs text-muted-foreground'}>
                {noteRequired
                  ? t('markPaid.difference', {
                      amount: `${difference > 0 ? '+' : '−'}${money.format(Math.abs(difference))}`,
                      total: money.format(document.totals.total),
                    })
                  : t('markPaid.matchesTotal')}
              </p>
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="paid-note">
              {noteRequired ? required(t('markPaid.note')) : t('markPaid.noteOptional')}
            </Label>
            <Textarea
              id="paid-note"
              rows={2}
              maxLength={500}
              aria-invalid={noteRequired && !note?.trim()}
              placeholder={t(noteRequired ? 'markPaid.notePlaceholderDiff' : 'markPaid.notePlaceholder')}
              {...register('note')}
            />
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
            <span className="text-xs text-muted-foreground">
              {t(document.purpose === 'upgrade' ? 'markPaid.upgradeNote' : 'markPaid.startNote')}
            </span>
          </div>

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-3.5" aria-hidden="true" />
            {t('markPaid.emailedAfter')}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('quotation.cancel')}
            </Button>
            <Button type="submit" disabled={pay.isPending || (noteRequired && !note?.trim())}>
              <Check aria-hidden="true" />
              {t(expired ? 'markPaid.confirmExpired' : 'markPaid.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const KNOWN_ERRORS = ['seats_below_users', 'reference_used', 'note_required', 'paid_in_future', 'upgrade_outdated']

/**
 * The invoice goes out by itself after the payment (P23): drawn here, sent
 * to its default recipients (the quotation's, else the company admins). A
 * failure stays on screen with Retry, or Email… for the full email step.
 */
function InvoiceMailer({
  invoice,
  onClose,
  onEmail,
}: {
  invoice: BillingDocumentSummary
  onClose: () => void
  onEmail?: () => void
}) {
  const { t } = useTranslation('admin')
  const defaults = useSendDefaultsQuery(invoice.id)
  const { pdf, isError: drawFailed } = useBillingPdf(invoice)
  const send = useSendDocumentMutation()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  async function sendNow() {
    if (!pdf || !defaults.data) return
    setFailed(false)
    try {
      await send.mutateAsync({
        id: invoice.id,
        input: { to: defaults.data.to, subject: defaults.data.subject, copyMe: true, pdfBase64: await pdfToBase64(pdf) },
      })
      toast.success(t('markPaid.emailed', { number: invoice.number, count: defaults.data.to.length }))
      onClose()
    } catch {
      setFailed(true)
    }
  }

  const noRecipients = defaults.data?.to.length === 0
  useEffect(() => {
    if (started.current || !pdf || !defaults.data || noRecipients) return
    started.current = true
    void sendNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, defaults.data, noRecipients])

  const stuck = failed || drawFailed || defaults.isError || noRecipients
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('markPaid.recordedTitle', { number: invoice.number })}</DialogTitle>
          <DialogDescription>{t('markPaid.recordedDescription')}</DialogDescription>
        </DialogHeader>
        {stuck ? (
          <p role="alert" className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t(noRecipients ? 'markPaid.notEmailedNoAddress' : 'markPaid.notEmailed')}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t('markPaid.emailing', { to: defaults.data?.to.join(', ') ?? '…' })}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('markPaid.close')}
          </Button>
          {stuck && onEmail && (
            <Button type="button" variant="outline" onClick={onEmail}>
              <Mail aria-hidden="true" />
              {t('markPaid.emailManually')}
            </Button>
          )}
          {stuck && !noRecipients && (
            <Button type="button" disabled={send.isPending || !pdf} onClick={() => void sendNow()}>
              <RotateCw aria-hidden="true" />
              {t('markPaid.retry')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
