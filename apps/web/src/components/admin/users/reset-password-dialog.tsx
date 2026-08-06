import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { resetUserPasswordSchema, type ResetUserPasswordInput } from '@repo/types/users'
import type { UserSummary } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useResetUserPasswordMutation } from '@/lib/users-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const mutation = useResetUserPasswordMutation(user?.id ?? '')

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
      toast.success(t('resetPassword.success'))
      reset()
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('resetPassword.error')))
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
            <DialogTitle>{t('resetPassword.title', { email: user.email })}</DialogTitle>
            <DialogDescription>{t('resetPassword.description')}</DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="reset-password-field">{t('resetPassword.field')}</Label>
            <Input
              id="reset-password-field"
              type="password"
              autoComplete="new-password"
              className="mt-1.5"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'resetPassword.submit.submitting' : 'resetPassword.submit.idle')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
