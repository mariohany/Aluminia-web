import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UserSummary } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import {
  useDeactivateUserMutation,
  useEndUserSessionMutation,
  useReactivateUserMutation,
} from '@/lib/users-queries'
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

export type UserActionKind = 'deactivate' | 'reactivate' | 'end-session'

const COPY: Record<UserActionKind, { title: string; description: string; confirmAction: string; success: string }> = {
  deactivate: {
    title: 'deactivateUser.title',
    description: 'deactivateUser.description',
    confirmAction: 'deactivateUser.confirmAction',
    success: 'deactivateUser.success',
  },
  reactivate: {
    title: 'reactivateUser.title',
    description: 'reactivateUser.description',
    confirmAction: 'reactivateUser.confirmAction',
    success: 'reactivateUser.success',
  },
  'end-session': {
    title: 'endSessionUser.title',
    description: 'endSessionUser.description',
    confirmAction: 'endSessionUser.confirmAction',
    success: 'endSessionUser.success',
  },
}

export function UserActionDialog({
  user,
  kind,
  open,
  onOpenChange,
}: {
  user: UserSummary | null
  kind: UserActionKind | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const deactivate = useDeactivateUserMutation(user?.id ?? '')
  const reactivate = useReactivateUserMutation(user?.id ?? '')
  const endSession = useEndUserSessionMutation(user?.id ?? '')

  if (!user || !kind) return null

  const copy = COPY[kind]
  const mutation = kind === 'deactivate' ? deactivate : kind === 'reactivate' ? reactivate : endSession

  const handleConfirm = async () => {
    try {
      await mutation.mutateAsync()
      toast.success(t(copy.success, { email: user.email }))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('companyDetail.actions.error')))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(copy.title, { email: user.email })}</AlertDialogTitle>
          <AlertDialogDescription>{t(copy.description)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant={kind === 'deactivate' ? 'destructive' : 'default'}
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
          >
            {t(copy.confirmAction)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
