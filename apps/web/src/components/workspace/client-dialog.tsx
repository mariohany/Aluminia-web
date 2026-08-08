import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  createClientSchema,
  type ClientSummary,
  type CreateClientInput,
} from '@repo/types/clients'
import { apiErrorMessage } from '@/lib/api-client'
import { optionalTextField } from '@/lib/form-fields'
import { useCreateClientMutation, useUpdateClientMutation } from '@/lib/clients-queries'
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

interface ClientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Absent for create; present for edit. */
  client?: Pick<ClientSummary, 'id' | 'enName' | 'arName'>
  onCreated?: (client: ClientSummary) => void
}

/**
 * Create or rename a client. Dialogs write; the properties panel reads —
 * one write path per row, so validation cannot drift between two
 * surfaces.
 *
 * Both language fields are present regardless of the interface
 * language: these are *content*, not chrome. Arabic is optional and
 * labelled so.
 */
export function ClientDialog({ open, onOpenChange, client, onCreated }: ClientDialogProps) {
  const { t } = useTranslation('workspace')
  const isEdit = !!client

  const createMutation = useCreateClientMutation()
  const updateMutation = useUpdateClientMutation(client?.id ?? '')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema),
    defaultValues: { enName: '', arName: null },
  })

  // Refill whenever the dialog opens on a different client — the form
  // is mounted once and reused, so stale defaults would otherwise show
  // the previously-edited record.
  useEffect(() => {
    if (open) reset({ enName: client?.enName ?? '', arName: client?.arName ?? null })
  }, [open, client, reset])

  const onSubmit = async (data: CreateClientInput) => {
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(data)
        toast.success(t('clientDialog.updated'))
      } else {
        const created = await createMutation.mutateAsync(data)
        toast.success(t('clientDialog.created', { name: created.enName }))
        onCreated?.(created)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('clientDialog.error')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? t('clientDialog.editTitle') : t('clientDialog.createTitle')}</DialogTitle>
            <DialogDescription>{t('clientDialog.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div>
              <FieldLabel htmlFor="client-en-name">{t('fields.enName')}</FieldLabel>
              <Input id="client-en-name" className="mt-1.5" dir="ltr" aria-invalid={!!errors.enName} {...register('enName')} />
              {errors.enName && <p className="mt-1 text-xs text-destructive">{errors.enName.message}</p>}
            </div>

            <div>
              <FieldLabel htmlFor="client-ar-name" optional>{t('fields.arName')}</FieldLabel>
              <Input id="client-ar-name" className="mt-1.5" dir="rtl" aria-invalid={!!errors.arName} {...register('arName', optionalTextField)} />
              {errors.arName && <p className="mt-1 text-xs text-destructive">{errors.arName.message}</p>}
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
  )
}
