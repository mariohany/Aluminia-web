import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { apiErrorMessage } from '@/lib/api-client'
import { useDeleteLeadsMutation } from '@/lib/leads-queries'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export function DeleteSelectedLeadsDialog({
  ids,
  onDeleted,
}: {
  ids: string[]
  onDeleted: () => void
}) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const mutation = useDeleteLeadsMutation()

  const handleDelete = async () => {
    try {
      const result = await mutation.mutateAsync(ids)
      toast.success(t('leadsSection.deleteSelectedSuccess', { count: result.deletedCount }))
      onDeleted()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('leadsSection.error')))
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          {t('leadsSection.deleteSelected', { count: ids.length })}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('leadsSection.deleteSelectedConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('leadsSection.deleteSelectedConfirmDescription', { count: ids.length })}
          </AlertDialogDescription>
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
            {t('leadsSection.deleteSelectedConfirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
