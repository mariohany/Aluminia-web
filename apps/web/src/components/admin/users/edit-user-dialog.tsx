import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UserRole } from '@repo/types/auth'
import type { UserSummary } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useCompaniesQuery } from '@/lib/companies-queries'
import { useUpdateUserMutation } from '@/lib/users-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface EditUserFormValues {
  email: string
  role: UserRole
  companyId: string
}

export function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const { data: companies } = useCompaniesQuery()
  const mutation = useUpdateUserMutation(user?.id ?? '')

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EditUserFormValues>({
    defaultValues: { email: '', role: 'user', companyId: '' },
  })

  useEffect(() => {
    if (user) reset({ email: user.email, role: user.role, companyId: user.companyId ?? '' })
  }, [user, reset])

  const selectedRole = watch('role')
  const selectedCompanyId = watch('companyId')
  const isSuperAdmin = selectedRole === 'super_admin'
  const isMovingCompany = !isSuperAdmin && !!user?.companyId && selectedCompanyId !== user.companyId

  if (!user) return null

  const onSubmit = async (data: EditUserFormValues) => {
    try {
      await mutation.mutateAsync({
        email: data.email,
        role: data.role,
        companyId: data.role === 'super_admin' ? null : data.companyId,
      })
      toast.success(t('editUser.success'))
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('editUser.error')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('editUser.title')}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="edit-user-email">{t('editUser.fields.email')}</Label>
              <Input
                id="edit-user-email"
                type="email"
                autoComplete="off"
                className="mt-1.5"
                aria-invalid={!!errors.email}
                {...register('email', { required: true })}
              />
            </div>

            <div>
              <Label htmlFor="edit-user-role">{t('editUser.fields.role')}</Label>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="edit-user-role" className="mt-1.5 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="super_admin">{t('usersPage.role.super_admin')}</SelectItem>
                      <SelectItem value="company_admin">{t('usersPage.role.company_admin')}</SelectItem>
                      <SelectItem value="user">{t('usersPage.role.user')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {isSuperAdmin ? (
              <p className="text-xs text-muted-foreground">{t('editUser.superAdminNoCompany')}</p>
            ) : (
              <div>
                <Label htmlFor="edit-user-company">{t('editUser.fields.company')}</Label>
                <Controller
                  control={control}
                  name="companyId"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="edit-user-company"
                        className="mt-1.5 w-full"
                        aria-invalid={!!errors.companyId}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(companies ?? []).map((company) => (
                          <SelectItem key={company.id} value={company.id}>
                            {company.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            )}

            {isMovingCompany && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                {t('editUser.companyMoveWarning', { email: user.email })}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'editUser.submit.submitting' : 'editUser.submit.idle')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
