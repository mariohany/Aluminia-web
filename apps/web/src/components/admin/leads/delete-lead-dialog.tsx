import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { LeadSummary } from '@repo/types/leads'
import { apiErrorMessage } from '@/lib/api-client'
import { useDeleteLeadMutation } from '@/lib/leads-queries'
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

// No typed confirmation, unlike deleting a company or a user: a lead is
// a form submission, not a tenant's data — the stakes don't call for
// the extra friction.
export function DeleteLeadDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const mutation = useDeleteLeadMutation()

  if (!lead) return null

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync(lead.id)
      toast.success(t('leadsSection.deleteSuccess', { name: lead.companyName }))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('leadsSection.error')))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('leadsSection.deleteConfirmTitle', { name: lead.companyName })}</AlertDialogTitle>
          <AlertDialogDescription>{t('leadsSection.deleteConfirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault()
              void handleDelete()
            }}
          >
            {t('leadsSection.deleteConfirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
