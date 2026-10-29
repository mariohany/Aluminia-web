import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { apiErrorMessage } from '@/lib/api-client'
import { useVoidQuotationMutation } from '@/lib/billing-queries'
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
import { Textarea } from '@/components/ui/textarea'

/** Void can't be undone, so it asks first; the reason is optional and shows under the Void status. */
export function VoidQuotationDialog({
  document,
  onOpenChange,
}: {
  document: BillingDocumentSummary | null
  onOpenChange: (open: boolean) => void
}) {
  // Keyed so each quotation starts with an empty reason.
  return document && <VoidDialogContent key={document.id} document={document} onOpenChange={onOpenChange} />
}

function VoidDialogContent({
  document,
  onOpenChange,
}: {
  document: BillingDocumentSummary
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const mutation = useVoidQuotationMutation()
  const [reason, setReason] = useState('')

  const handleVoid = async () => {
    try {
      await mutation.mutateAsync({ id: document.id, input: { reason: reason.trim() || null } })
      toast.success(t('documents.actions.voided', { number: document.number }))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('documents.actions.error')))
    }
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('documents.actions.voidTitle', { number: document.number })}</AlertDialogTitle>
          <AlertDialogDescription>{t('documents.actions.voidDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="void-reason">{t('documents.actions.voidReason')}</Label>
          <Textarea
            id="void-reason"
            value={reason}
            maxLength={200}
            placeholder={t('documents.actions.voidReasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault()
              void handleVoid()
            }}
          >
            {t('documents.actions.void')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
