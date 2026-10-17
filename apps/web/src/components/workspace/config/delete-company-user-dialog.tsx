import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UserSummary } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useDeleteCompanyUserMutation } from '@/lib/company-users-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel } from '@/components/workspace/field-label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Same typed-confirmation weight as deleting a client: irreversible. */
export function DeleteCompanyUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('workspace')
  const [confirmEmail, setConfirmEmail] = useState('')
  const mutation = useDeleteCompanyUserMutation(user?.id ?? '')

  if (!user) return null

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync(confirmEmail)
      toast.success(t('manage.deleteUser.success', { email: user.email }))
      setConfirmEmail('')
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('manage.deleteUser.error')))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setConfirmEmail('')
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('manage.deleteUser.title')}</DialogTitle>
          <DialogDescription>{t('manage.deleteUser.warning', { email: user.email })}</DialogDescription>
        </DialogHeader>

        <div>
          <FieldLabel htmlFor="confirm-company-user-email">
            {t('manage.deleteUser.confirmLabel', { email: user.email })}
          </FieldLabel>
          <Input
            id="confirm-company-user-email"
            className="mt-1.5"
            dir="ltr"
            value={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.value)}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={confirmEmail.trim() !== user.email || mutation.isPending}
            onClick={() => void handleDelete()}
          >
            {t('actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
