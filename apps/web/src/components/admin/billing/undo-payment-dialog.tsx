import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { apiErrorMessage } from '@/lib/api-client'
import { useUndoPaymentMutation } from '@/lib/billing-queries'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { RequiredMark } from '@/components/ui/required-mark'
import { Textarea } from '@/components/ui/textarea'

/**
 * Undo payment (docs/payment_cycle_planing.md P22, P23): only on today's
 * latest invoice (`canUndo`). Says what happens, asks why (kept in the
 * history), and reports whether the client's cancellation email went out.
 */
export function UndoPaymentDialog({
  document,
  onOpenChange,
}: {
  document: BillingDocumentSummary | null
  onOpenChange: (open: boolean) => void
}) {
  // Keyed so each invoice starts with an empty reason.
  return document && <UndoDialogContent key={document.id} document={document} onOpenChange={onOpenChange} />
}

function UndoDialogContent({
  document,
  onOpenChange,
}: {
  document: BillingDocumentSummary
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const mutation = useUndoPaymentMutation()
  const [reason, setReason] = useState('')

  const handleUndo = async () => {
    try {
      const result = await mutation.mutateAsync({ id: document.id, reason: reason.trim() })
      if (result.emailed) {
        toast.success(t('undo.done', { number: document.number, count: result.to.length }))
      } else {
        toast.warning(t('undo.doneNotEmailed', { number: document.number }))
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('documents.actions.error')))
    }
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('undo.title', { number: document.number })}</AlertDialogTitle>
          <AlertDialogDescription>{t('undo.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-[13px] text-foreground">
          <li>{t('undo.invoiceGone', { number: document.number })}</li>
          <li>{t('undo.quotationBack', { number: document.quotationNumber ?? '—' })}</li>
          <li>{t('undo.companyBack')}</li>
          <li>{t('undo.clientEmailed')}</li>
        </ul>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="undo-reason">
            {t('undo.reason')} <RequiredMark />
          </Label>
          <Textarea
            id="undo-reason"
            value={reason}
            maxLength={200}
            placeholder={t('undo.reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending || !reason.trim()}
            onClick={(e) => {
              e.preventDefault()
              void handleUndo()
            }}
          >
            {t('undo.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
