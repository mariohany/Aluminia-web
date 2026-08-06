import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { createCompanySchema, type CreateCompanyInput } from '@repo/types/companies'
import { apiErrorMessage } from '@/lib/api-client'
import { useCreateCompanyMutation } from '@/lib/companies-queries'
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
  DialogTrigger,
} from '@/components/ui/dialog'

export function CreateCompanyDialog() {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const mutation = useCreateCompanyMutation()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCompanyInput>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: { name: '', plan: '', maxUsers: 5, admin: { email: '', password: '' } },
  })

  const onSubmit = async (data: CreateCompanyInput) => {
    try {
      const company = await mutation.mutateAsync(data)
      toast.success(t('createCompany.success', { name: company.name }))
      reset()
      setOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('createCompany.error')))
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
          {t('companiesPage.createButton')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('createCompany.title')}</DialogTitle>
            <DialogDescription>{t('createCompany.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="company-name">{t('createCompany.fields.name')}</Label>
              <Input
                id="company-name"
                className="mt-1.5"
                aria-invalid={!!errors.name}
                {...register('name')}
              />
              {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div>
              <Label htmlFor="company-plan">{t('createCompany.fields.plan')}</Label>
              <Input
                id="company-plan"
                className="mt-1.5"
                aria-invalid={!!errors.plan}
                {...register('plan')}
              />
              {errors.plan && <p className="mt-1 text-xs text-destructive">{errors.plan.message}</p>}
            </div>

            <div>
              <Label htmlFor="company-max-users">{t('createCompany.fields.maxUsers')}</Label>
              <Input
                id="company-max-users"
                type="number"
                min={1}
                className="mt-1.5"
                aria-invalid={!!errors.maxUsers}
                {...register('maxUsers', { valueAsNumber: true })}
              />
              {errors.maxUsers && (
                <p className="mt-1 text-xs text-destructive">{errors.maxUsers.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="company-admin-email">{t('createCompany.fields.adminEmail')}</Label>
              <Input
                id="company-admin-email"
                type="email"
                autoComplete="off"
                className="mt-1.5"
                aria-invalid={!!errors.admin?.email}
                {...register('admin.email')}
              />
              {errors.admin?.email && (
                <p className="mt-1 text-xs text-destructive">{errors.admin.email.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="company-admin-password">{t('createCompany.fields.adminPassword')}</Label>
              <Input
                id="company-admin-password"
                type="password"
                autoComplete="new-password"
                className="mt-1.5"
                aria-invalid={!!errors.admin?.password}
                {...register('admin.password')}
              />
              {errors.admin?.password && (
                <p className="mt-1 text-xs text-destructive">{errors.admin.password.message}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'createCompany.submit.submitting' : 'createCompany.submit.idle')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
