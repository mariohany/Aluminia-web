import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ProjectStatus } from '@repo/types/project-settings'
import { apiErrorMessage } from '@/lib/api-client'
import { displayName } from '@/lib/bilingual'
import { useDeleteProjectStatusMutation } from '@/lib/project-settings-queries'
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

/** A simple confirm (Q4): only an empty status gets here, since Delete is
 * disabled while projects use one. The API still refuses if one arrived
 * meanwhile, and that message is shown. */
export function DeleteProjectStatusDialog({
  status,
  onOpenChange,
}: {
  status: ProjectStatus | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation('workspace')
  const mutation = useDeleteProjectStatusMutation()

  const confirm = async () => {
    if (!status) return
    try {
      await mutation.mutateAsync(status.id)
      toast.success(t('config.projects.deleteDialog.deleted'))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('config.projects.deleteDialog.error')))
    }
  }

  return (
    <AlertDialog open={!!status} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('config.projects.deleteDialog.title', { name: status ? displayName(status, i18n.language) : '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('config.projects.deleteDialog.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault()
              void confirm()
            }}
          >
            {t('config.projects.deleteDialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
