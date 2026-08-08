import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UserSummary } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useDeactivateCompanyUserMutation, useReactivateCompanyUserMutation } from '@/lib/company-users-queries'
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

export type CompanyUserActionKind = 'deactivate' | 'reactivate'

/** Deactivate/reactivate — mirrors the admin console's user-action dialog. */
export function CompanyUserActionDialog({
  user,
  kind,
  open,
  onOpenChange,
}: {
  user: UserSummary | null
  kind: CompanyUserActionKind | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('workspace')
  const deactivate = useDeactivateCompanyUserMutation(user?.id ?? '')
  const reactivate = useReactivateCompanyUserMutation(user?.id ?? '')

  if (!user || !kind) return null

  const mutation = kind === 'deactivate' ? deactivate : reactivate

  const handleConfirm = async () => {
    try {
      await mutation.mutateAsync()
      toast.success(t(`manage.${kind}User.success`, { email: user.email }))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('manage.actionError')))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`manage.${kind}User.title`, { email: user.email })}</AlertDialogTitle>
          <AlertDialogDescription>{t(`manage.${kind}User.description`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant={kind === 'deactivate' ? 'destructive' : 'default'}
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
          >
            {t(`manage.${kind}User.confirmAction`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
