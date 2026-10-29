import { useTranslation } from 'react-i18next'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { useSendDefaultsQuery } from '@/lib/billing-queries'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmailStep } from './email-step'

/** Email on a saved document opens the email step alone (B18). */
export function EmailDocumentDialog({
  document,
  recipients,
  onOpenChange,
}: {
  document: BillingDocumentSummary | null
  recipients: string[]
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const defaults = useSendDefaultsQuery(document?.id ?? null)
  return (
    <Dialog open={document !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{document && t('email.title', { number: document.number })}</DialogTitle>
          <DialogDescription>{t('email.description')}</DialogDescription>
        </DialogHeader>
        {document && defaults.data && (
          <EmailStep
            key={document.id}
            document={document}
            recipients={recipients}
            subject={defaults.data.subject}
            onCancel={() => onOpenChange(false)}
            onSent={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
