import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { createCompanyUserSchema, type CreateCompanyUserInput } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useCreateCompanyUserMutation } from '@/lib/company-users-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { FieldLabel } from '@/components/workspace/field-label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/**
 * Adds a plain `user` to the caller's own company. There is no role
 * field and no company field here — `createCompanyUserSchema` carries
 * only email and password, and the server hardcodes the rest from the
 * JWT. A company admin cannot mint another admin on this surface; only
 * the super admin does that (the recovery path for a locked-out
 * company).
 */
export function CreateCompanyUserDialog({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation('workspace')
  const [open, setOpen] = useState(false)
  const mutation = useCreateCompanyUserMutation()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCompanyUserInput>({
    resolver: zodResolver(createCompanyUserSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (data: CreateCompanyUserInput) => {
    try {
      const user = await mutation.mutateAsync(data)
      toast.success(t('manage.createUser.success', { email: user.email }))
      reset()
      setOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('manage.createUser.error')))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Plus className="size-4" aria-hidden="true" />
          {t('manage.addUser')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('manage.createUser.title')}</DialogTitle>
            <DialogDescription>{t('manage.createUser.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div>
              <FieldLabel htmlFor="company-user-email">{t('manage.fields.email')}</FieldLabel>
              <Input
                id="company-user-email"
                type="email"
                autoComplete="off"
                className="mt-1.5"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
              {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div>
              <FieldLabel htmlFor="company-user-password">{t('manage.fields.password')}</FieldLabel>
              <PasswordInput
                id="company-user-password"
                autoComplete="new-password"
                className="mt-1.5"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'manage.createUser.submitting' : 'manage.createUser.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
