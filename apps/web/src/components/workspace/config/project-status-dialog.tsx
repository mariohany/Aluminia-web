import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import {
  PROJECT_STATUS_COLORS,
  createProjectStatusSchema,
  type CreateProjectStatusInput,
  type ProjectStatus,
  type ProjectStatusColor,
} from '@repo/types/project-settings'
import { apiErrorMessage } from '@/lib/api-client'
import { optionalTextField } from '@/lib/form-fields'
import { cn } from '@/lib/utils'
import { useCompanyUsersQuery } from '@/lib/company-users-queries'
import { useCreateProjectStatusMutation, useUpdateProjectStatusMutation } from '@/lib/project-settings-queries'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldLabel } from '@/components/workspace/field-label'
import { STATUS_DOT_CLASS } from '@/lib/project-status-colors'

/**
 * Add or edit one project status (board `cfg-ps-status-edit`): English
 * and Arabic name, one of the 8 colours, and the responsible users (the
 * company's active users, shown by email). `status` null = add.
 */
export function ProjectStatusDialog({
  open,
  onOpenChange,
  status,
  defaultColor,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ProjectStatus | null
  defaultColor: ProjectStatusColor
}) {
  const { t } = useTranslation('workspace')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remounted on every open (Radix unmounts closed content), so the
            form starts from the status it was opened for. */}
        {open && (
          <StatusForm
            key={status?.id ?? 'new'}
            status={status}
            defaultColor={defaultColor}
            onDone={() => onOpenChange(false)}
          />
        )}
        <DialogDescription className="sr-only">{t('config.projects.dialog.responsibleHint')}</DialogDescription>
      </DialogContent>
    </Dialog>
  )
}

function StatusForm({
  status,
  defaultColor,
  onDone,
}: {
  status: ProjectStatus | null
  defaultColor: ProjectStatusColor
  onDone: () => void
}) {
  const { t } = useTranslation('workspace')
  const users = useCompanyUsersQuery()
  const createMutation = useCreateProjectStatusMutation()
  const updateMutation = useUpdateProjectStatusMutation()

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectStatusInput>({
    resolver: zodResolver(createProjectStatusSchema),
    defaultValues: {
      enName: status?.enName ?? '',
      arName: status?.arName ?? null,
      color: status?.color ?? defaultColor,
      // Only ids still shown: anyone who left was already dropped by the API.
      responsibleUserIds: status?.responsible.map((user) => user.id) ?? [],
    },
  })
  const color = useWatch({ control, name: 'color' })
  const responsible = useWatch({ control, name: 'responsibleUserIds' })

  const activeUsers = (users.data ?? []).filter((user) => user.status === 'active')

  const toggleUser = (id: string, checked: boolean) =>
    setValue('responsibleUserIds', checked ? [...responsible, id] : responsible.filter((userId) => userId !== id), {
      shouldDirty: true,
      shouldValidate: true,
    })

  const onSubmit = async (input: CreateProjectStatusInput) => {
    try {
      if (status) {
        await updateMutation.mutateAsync({ id: status.id, input })
        toast.success(t('config.projects.dialog.saved'))
      } else {
        await createMutation.mutateAsync(input)
        toast.success(t('config.projects.dialog.added'))
      }
      onDone()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('config.projects.dialog.saveError')))
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {status ? t('config.projects.dialog.editTitle') : t('config.projects.dialog.addTitle')}
        </DialogTitle>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <FieldLabel htmlFor="status-en-name">{t('config.projects.dialog.enName')}</FieldLabel>
          <Input
            id="status-en-name"
            dir="ltr"
            className="mt-1.5"
            autoComplete="off"
            aria-invalid={!!errors.enName}
            {...register('enName')}
          />
          {errors.enName && <p className="mt-1 text-xs text-destructive">{errors.enName.message}</p>}
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor="status-ar-name" optional>
            {t('config.projects.dialog.arName')}
          </FieldLabel>
          <Input
            id="status-ar-name"
            dir="rtl"
            className="mt-1.5"
            autoComplete="off"
            aria-invalid={!!errors.arName}
            {...register('arName', optionalTextField)}
          />
          {errors.arName && <p className="mt-1 text-xs text-destructive">{errors.arName.message}</p>}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">{t('config.projects.dialog.color')}</legend>
        <div role="radiogroup" aria-label={t('config.projects.dialog.color')} className="flex flex-wrap gap-2">
          {PROJECT_STATUS_COLORS.map((key) => {
            const name = t(`config.projects.dialog.colorNames.${key}`)
            const selected = color === key
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={name}
                title={name}
                onClick={() => setValue('color', key, { shouldDirty: true, shouldValidate: true })}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  STATUS_DOT_CLASS[key],
                  selected && 'ring-2 ring-foreground',
                )}
              >
                {selected && <Check className="size-4 text-white" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-foreground">{t('config.projects.dialog.responsible')}</legend>
        <p className="mb-2 text-[12.5px] text-muted-foreground">{t('config.projects.dialog.responsibleHint')}</p>
        {users.isLoading && <p className="text-sm text-muted-foreground">{t('tree.loading')}</p>}
        {users.data && activeUsers.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('config.projects.dialog.noUsers')}</p>
        )}
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {activeUsers.map((user) => {
            const id = `status-user-${user.id}`
            return (
              <li key={user.id}>
                <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/60">
                  <Checkbox
                    id={id}
                    checked={responsible.includes(user.id)}
                    onCheckedChange={(checked) => toggleUser(user.id, checked === true)}
                  />
                  <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-foreground uppercase">
                    <span aria-hidden="true">{user.email.slice(0, 2)}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm" dir="ltr">
                    {user.email}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('actions.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {status ? t('actions.save') : t('config.projects.dialog.addTitle')}
        </Button>
      </DialogFooter>
    </form>
  )
}
