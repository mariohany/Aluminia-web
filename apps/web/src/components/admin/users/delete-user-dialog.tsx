import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UserSummary } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useDeleteUserMutation } from '@/lib/users-queries'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export function DeleteUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const [confirmEmail, setConfirmEmail] = useState('')
  const mutation = useDeleteUserMutation(user?.id ?? '')

  if (!user) return null

  const matches = confirmEmail === user.email

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync(confirmEmail)
      toast.success(t('deleteUser.success', { email: user.email }))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('deleteUser.error')))
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setConfirmEmail('')
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteUser.title', { email: user.email })}</AlertDialogTitle>
          <AlertDialogDescription>{t('deleteUser.description')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div>
          <Label htmlFor="delete-user-confirm-email">
            {t('deleteUser.confirmLabel', { email: user.email })}
          </Label>
          <Input
            id="delete-user-confirm-email"
            className="mt-1.5"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            autoComplete="off"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matches || mutation.isPending}
            onClick={(e) => {
              e.preventDefault()
              void handleDelete()
            }}
          >
            {t('deleteUser.confirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
