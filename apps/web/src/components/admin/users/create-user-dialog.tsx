import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { createUserSchema, type CreateUserInput } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useCompaniesQuery } from '@/lib/companies-queries'
import { useCreateUserMutation } from '@/lib/users-queries'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function CreateUserDialog() {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const mutation = useCreateUserMutation()
  const { data: companies } = useCompaniesQuery()

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', password: '', role: 'user', companyId: '' },
  })

  const onSubmit = async (data: CreateUserInput) => {
    try {
      const user = await mutation.mutateAsync(data)
      toast.success(t('createUser.success', { email: user.email }))
      reset()
      setOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('createUser.error')))
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
        <Button size="sm">
          <Plus className="size-4" aria-hidden="true" />
          {t('usersPage.createButton')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('createUser.title')}</DialogTitle>
            <DialogDescription>{t('createUser.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="user-email">{t('createUser.fields.email')}</Label>
              <Input
                id="user-email"
                type="email"
                autoComplete="off"
                className="mt-1.5"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
              {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div>
              <Label htmlFor="user-password">{t('createUser.fields.password')}</Label>
              <Input
                id="user-password"
                type="password"
                autoComplete="new-password"
                className="mt-1.5"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <div>
              <Label htmlFor="user-role">{t('createUser.fields.role')}</Label>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="user-role" className="mt-1.5 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company_admin">{t('usersPage.role.company_admin')}</SelectItem>
                      <SelectItem value="user">{t('usersPage.role.user')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div>
              <Label htmlFor="user-company">{t('createUser.fields.company')}</Label>
              <Controller
                control={control}
                name="companyId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="user-company" className="mt-1.5 w-full" aria-invalid={!!errors.companyId}>
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
              {errors.companyId && <p className="mt-1 text-xs text-destructive">{errors.companyId.message}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'createUser.submit.submitting' : 'createUser.submit.idle')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
