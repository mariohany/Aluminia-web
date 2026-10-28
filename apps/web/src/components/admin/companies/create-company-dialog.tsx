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
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { RequiredMark } from '@/components/ui/required-mark'
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
    defaultValues: { name: '', nameAr: '', admin: { email: '', password: '' } },
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="company-name">
                  {t('createCompany.fields.name')}
                  <RequiredMark />
                </Label>
                <Input id="company-name" className="mt-1.5" aria-invalid={!!errors.name} {...register('name')} />
                {errors.name && <p className="mt-1 text-xs text-destructive">{t('createCompany.required')}</p>}
              </div>
              <div>
                <Label htmlFor="company-name-ar">
                  {t('createCompany.fields.nameAr')}
                  <RequiredMark />
                </Label>
                <Input
                  id="company-name-ar"
                  dir="rtl"
                  className="mt-1.5"
                  aria-invalid={!!errors.nameAr}
                  {...register('nameAr')}
                />
                {errors.nameAr && <p className="mt-1 text-xs text-destructive">{t('createCompany.required')}</p>}
              </div>
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
              <PasswordInput
                id="company-admin-password"
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

          <p className="text-xs text-muted-foreground">{t('createCompany.startsOnFree')}</p>

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
