import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { resetUserPasswordSchema, type ResetUserPasswordInput, type UserSummary } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useResetCompanyUserPasswordMutation } from '@/lib/company-users-queries'
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

/**
 * The only password-recovery path that exists here: there is no email
 * pipeline, so a colleague forgets their password and the company
 * admin sets a new one directly. Revokes their session server-side, so
 * the new password is required immediately rather than on next expiry.
 */
export function ResetCompanyUserPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('workspace')
  const mutation = useResetCompanyUserPasswordMutation(user?.id ?? '')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ResetUserPasswordInput>({
    resolver: zodResolver(resetUserPasswordSchema),
    defaultValues: { password: '' },
  })

  if (!user) return null

  const onSubmit = async (data: ResetUserPasswordInput) => {
    try {
      await mutation.mutateAsync(data.password)
      toast.success(t('manage.resetPassword.success'))
      reset()
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('manage.resetPassword.error')))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('manage.resetPassword.title', { email: user.email })}</DialogTitle>
            <DialogDescription>{t('manage.resetPassword.description')}</DialogDescription>
          </DialogHeader>

          <div>
            <FieldLabel htmlFor="reset-company-user-password">{t('manage.fields.newPassword')}</FieldLabel>
            <Input
              id="reset-company-user-password"
              type="password"
              autoComplete="new-password"
              className="mt-1.5"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'manage.resetPassword.submitting' : 'manage.resetPassword.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
