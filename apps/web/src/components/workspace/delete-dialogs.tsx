import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { apiErrorMessage } from '@/lib/api-client'
import { useClientQuery, useDeleteClientMutation } from '@/lib/clients-queries'
import { useDeleteProjectMutation } from '@/lib/projects-queries'
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

/**
 * Deleting a client cascades to every project under it, so it gets the
 * heavier confirmation: the exact English name typed back, plus a live
 * count of what goes with it. The server re-checks the name against the
 * stored row — this is a speed bump, not the guard.
 */
export function DeleteClientDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
  onDeleted,
}: {
  clientId: string
  clientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const { t } = useTranslation('workspace')
  const [confirmName, setConfirmName] = useState('')
  const mutation = useDeleteClientMutation(clientId)
  // Fetched fresh rather than counted from the cached tree: the number
  // shown must be what is actually about to be destroyed.
  const detail = useClientQuery(open ? clientId : undefined)

  useEffect(() => {
    if (open) setConfirmName('')
  }, [open])

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync(confirmName)
      toast.success(t('deleteClient.success', { name: clientName }))
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('deleteClient.error')))
    }
  }

  const projectCount = detail.data?.projectCount ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteClient.title')}</DialogTitle>
          <DialogDescription>
            {projectCount > 0
              ? t('deleteClient.warningWithProjects', { name: clientName, count: projectCount })
              : t('deleteClient.warning', { name: clientName })}
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="confirm-client-name">{t('deleteClient.confirmLabel', { name: clientName })}</Label>
          <Input
            id="confirm-client-name"
            className="mt-1.5"
            dir="ltr"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            // Disabled until it matches, so the confirmation is read
            // rather than clicked through. The server checks anyway.
            disabled={confirmName.trim() !== clientName || mutation.isPending}
            onClick={() => void handleDelete()}
          >
            {t('actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Deleting a project destroys one row, so a plain confirmation is
 * enough. Demanding a typed name for every single-row delete trains
 * people to type without reading, which makes the confirmation that
 * genuinely matters — the client cascade above — weaker.
 */
export function DeleteProjectDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  onDeleted,
}: {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const { t } = useTranslation('workspace')
  const mutation = useDeleteProjectMutation(projectId)

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync()
      toast.success(t('deleteProject.success', { name: projectName }))
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('deleteProject.error')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteProject.title')}</DialogTitle>
          <DialogDescription>{t('deleteProject.warning', { name: projectName })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => void handleDelete()}>
            {t('actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
