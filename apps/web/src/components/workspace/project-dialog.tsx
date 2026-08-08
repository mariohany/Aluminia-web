import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { createProjectSchema, type CreateProjectInput, type ProjectDetail } from '@repo/types/projects'
import type { ClientWithProjects } from '@repo/types/clients'
import { apiErrorMessage } from '@/lib/api-client'
import { optionalTextField } from '@/lib/form-fields'
import { displayName } from '@/lib/bilingual'
import { useCreateProjectMutation, useUpdateProjectMutation } from '@/lib/projects-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel } from '@/components/workspace/field-label'
import { Textarea } from '@/components/ui/textarea'
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
} from '@/components/ui/dialog'
import { ClientDialog } from '@/components/workspace/client-dialog'

interface ProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: ClientWithProjects[]
  language: string
  /** Absent for create; present for edit. */
  project?: ProjectDetail
  /**
   * The client to pre-select on create — whichever client or project
   * is currently selected in the tree. Ignored on edit, where the
   * client is fixed and the selector isn't shown at all.
   */
  defaultClientId?: string
  onCreated?: (project: ProjectDetail) => void
}

/**
 * Create or edit a project.
 *
 * On edit, `clientId` is deliberately not shown and not sent: a project
 * cannot be moved between clients. Note the API *strips* an unknown
 * `clientId` rather than rejecting it, so sending a whole ProjectDetail
 * back would look like it worked while silently ignoring the field —
 * this form registers only editable fields for exactly that reason.
 */
export function ProjectDialog({
  open,
  onOpenChange,
  clients,
  language,
  project,
  defaultClientId,
  onCreated,
}: ProjectDialogProps) {
  const { t } = useTranslation('workspace')
  const isEdit = !!project
  const [clientDialogOpen, setClientDialogOpen] = useState(false)

  const createMutation = useCreateProjectMutation()
  const updateMutation = useUpdateProjectMutation(project?.id ?? '')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: emptyProject(defaultClientId),
  })

  useEffect(() => {
    if (!open) return
    reset(
      project
        ? {
            clientId: project.clientId,
            enName: project.enName,
            arName: project.arName,
            enAddress: project.enAddress,
            arAddress: project.arAddress,
            notes: project.notes,
            phone: project.phone,
            email: project.email,
          }
        : emptyProject(defaultClientId),
    )
  }, [open, project, reset, defaultClientId])

  const clientId = watch('clientId')

  const onSubmit = async (data: CreateProjectInput) => {
    try {
      if (isEdit) {
        // Only the editable fields. `clientId` is omitted rather than
        // sent-and-ignored.
        const { clientId: _ignored, ...editable } = data
        await updateMutation.mutateAsync(editable)
        toast.success(t('projectDialog.updated'))
      } else {
        const created = await createMutation.mutateAsync(data)
        toast.success(t('projectDialog.created', { name: created.enName }))
        onCreated?.(created)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('projectDialog.error')))
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {isEdit ? t('projectDialog.editTitle') : t('projectDialog.createTitle')}
              </DialogTitle>
              <DialogDescription>{t('projectDialog.description')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              {/* Only on create. A project cannot change client. */}
              {!isEdit && (
                <div>
                  <FieldLabel htmlFor="project-client">{t('fields.client')}</FieldLabel>
                  <div className="mt-1.5 flex gap-2">
                    <Select value={clientId ?? ''} onValueChange={(value) => setValue('clientId', value, { shouldValidate: true })}>
                      <SelectTrigger id="project-client" className="flex-1" aria-invalid={!!errors.clientId}>
                        <SelectValue placeholder={t('fields.clientPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {displayName(client, language)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Without this, a user with no clients yet cannot
                        create anything at all: client_id is NOT NULL, so
                        an empty workspace would dead-end here. */}
                    <Button type="button" variant="outline" size="icon" aria-label={t('actions.newClient')} onClick={() => setClientDialogOpen(true)}>
                      <Plus className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  {errors.clientId && <p className="mt-1 text-xs text-destructive">{t('fields.clientRequired')}</p>}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="project-en-name">{t('fields.enName')}</FieldLabel>
                  <Input id="project-en-name" className="mt-1.5" dir="ltr" aria-invalid={!!errors.enName} {...register('enName')} />
                  {errors.enName && <p className="mt-1 text-xs text-destructive">{errors.enName.message}</p>}
                </div>
                <div>
                  <FieldLabel htmlFor="project-ar-name" optional>{t('fields.arName')}</FieldLabel>
                  <Input id="project-ar-name" className="mt-1.5" dir="rtl" {...register('arName', optionalTextField)} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="project-en-address" optional>{t('fields.enAddress')}</FieldLabel>
                  <Input id="project-en-address" className="mt-1.5" dir="ltr" {...register('enAddress', optionalTextField)} />
                </div>
                <div>
                  <FieldLabel htmlFor="project-ar-address" optional>{t('fields.arAddress')}</FieldLabel>
                  <Input id="project-ar-address" className="mt-1.5" dir="rtl" {...register('arAddress', optionalTextField)} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="project-phone" optional>{t('fields.phone')}</FieldLabel>
                  <Input id="project-phone" className="mt-1.5" dir="ltr" {...register('phone', optionalTextField)} />
                </div>
                <div>
                  <FieldLabel htmlFor="project-email" optional>{t('fields.email')}</FieldLabel>
                  <Input id="project-email" className="mt-1.5" dir="ltr" type="email" aria-invalid={!!errors.email} {...register('email', optionalTextField)} />
                  {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="project-notes" optional>{t('fields.notes')}</FieldLabel>
                <Textarea id="project-notes" className="mt-1.5" rows={3} {...register('notes', optionalTextField)} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isEdit ? t('actions.save') : t('actions.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Nested so a missing client never dead-ends the project form.
          The new client is selected on return. */}
      <ClientDialog
        open={clientDialogOpen}
        onOpenChange={setClientDialogOpen}
        onCreated={(created) => setValue('clientId', created.id, { shouldValidate: true })}
      />
    </>
  )
}

function emptyProject(defaultClientId?: string): CreateProjectInput {
  return {
    clientId: defaultClientId ?? '',
    enName: '',
    arName: null,
    enAddress: null,
    arAddress: null,
    notes: null,
    phone: null,
    email: null,
  }
}
