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
import { cn } from '@/lib/utils'
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
import { ProjectPreferencesFields } from '@/components/workspace/project-preferences-fields'
import { StepDot } from '@/components/workspace/step-dot'

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
  /**
   * Which step the dialog opens on. Defaults to 1 (Basic info). The
   * properties panel's Preferences section and the project row's
   * context menu both pass 2, so "edit preferences" lands directly on
   * that step rather than making the user click through step 1 again.
   */
  initialStep?: 1 | 2
  onCreated?: (project: ProjectDetail) => void
}

const STEP1_FIELDS = ['clientId', 'enName', 'email'] as const

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
  initialStep = 1,
  onCreated,
}: ProjectDialogProps) {
  const { t } = useTranslation('workspace')
  const isEdit = !!project
  const [clientDialogOpen, setClientDialogOpen] = useState(false)
  const [step, setStep] = useState<1 | 2>(initialStep)

  const createMutation = useCreateProjectMutation()
  const updateMutation = useUpdateProjectMutation(project?.id ?? '')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: emptyProject(defaultClientId),
  })

  useEffect(() => {
    if (!open) return
    setStep(initialStep)
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
            defaultSystemBrand: project.defaultSystemBrand,
            defaultSystemCatalog: project.defaultSystemCatalog,
            currency: project.currency,
            vatRate: project.vatRate,
            discountRate: project.discountRate,
          }
        : emptyProject(defaultClientId),
    )
  }, [open, project, reset, defaultClientId, initialStep])

  const clientId = watch('clientId')

  const goToStep2 = async () => {
    const valid = await trigger(STEP1_FIELDS)
    if (valid) setStep(2)
  }

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
              <DialogDescription>
                {step === 1 ? t('projectDialog.description') : t('projectDialog.stepPreferencesDescription')}
              </DialogDescription>
            </DialogHeader>

            {/* Two steps, one form, one submit — the dialog still
                writes through a single path. Step 2 is entirely
                optional, so `Create`/`Save` stays live on step 1
                rather than gating behind it. A short fixed-width
                connector (not `flex-1`) keeps the two steps close
                together as a compact unit instead of stretching them
                across the dialog's full width. */}
            <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
              <StepDot active={step === 1} done={step === 2} label="1" />
              <span>{t('projectDialog.stepBasicInfo')}</span>
              <span className="mx-1 h-px w-6 shrink-0 bg-border" />
              <StepDot active={step === 2} done={false} label="2" />
              <span>{t('projectDialog.stepPreferences')}</span>
            </div>

            <div className={cn('flex flex-col gap-3', step !== 1 && 'hidden')}>
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

            {/* Always mounted, just hidden — swapping steps must not
                reset either step's field values. */}
            <div className={cn(step !== 2 && 'hidden')}>
              <ProjectPreferencesFields watch={watch} setValue={setValue} />
            </div>

            <DialogFooter>
              {step === 2 && (
                <Button type="button" variant="outline" className="me-auto" onClick={() => setStep(1)}>
                  {t('actions.back')}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('actions.cancel')}
              </Button>
              {step === 1 && (
                <Button type="button" variant="outline" onClick={() => void goToStep2()}>
                  {t('actions.next')}
                </Button>
              )}
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
    defaultSystemBrand: null,
    defaultSystemCatalog: null,
    // Defaults to EGP rather than "no default" — this product quotes
    // almost exclusively in EGP, and a picker that starts empty just
    // means everyone re-picks the same value on every project. Still
    // overridable, and on EDIT the project's own (possibly null) value
    // is used instead — see the `reset()` call above.
    currency: 'EGP',
    vatRate: null,
    discountRate: null,
  }
}
