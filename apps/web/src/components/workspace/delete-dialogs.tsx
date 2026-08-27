import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { apiErrorMessage } from '@/lib/api-client'
import { useClientQuery, useDeleteClientMutation } from '@/lib/clients-queries'
import { useDeleteProjectMutation } from '@/lib/projects-queries'
import { useDeleteWindowMutation } from '@/lib/windows-queries'
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
 * Same typed-name confirmation as `DeleteClientDialog` — a project can
 * carry an unknown number of window designs, so a plain "are you sure"
 * isn't enough friction for an irreversible delete. The server
 * re-checks the name against the stored row — this is a speed bump,
 * not the guard.
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
  const [confirmName, setConfirmName] = useState('')
  const mutation = useDeleteProjectMutation(projectId)

  useEffect(() => {
    if (open) setConfirmName('')
  }, [open])

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync(confirmName)
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

        <div>
          <Label htmlFor="confirm-project-name">{t('deleteProject.confirmLabel', { name: projectName })}</Label>
          <Input
            id="confirm-project-name"
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
            disabled={confirmName.trim() !== projectName || mutation.isPending}
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
 * Plain confirmation, no typed name — unlike `DeleteClientDialog` and
 * `DeleteProjectDialog` above, a window design has no further cascade
 * under it worth that friction.
 */
export function DeleteWindowDialog({
  windowId,
  windowName,
  projectId,
  open,
  onOpenChange,
  onDeleted,
}: {
  windowId: string
  windowName: string
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const { t } = useTranslation('workspace')
  const mutation = useDeleteWindowMutation(windowId, projectId)

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync()
      toast.success(t('deleteWindow.success', { name: windowName }))
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('deleteWindow.error')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteWindow.title')}</DialogTitle>
          <DialogDescription>{t('deleteWindow.warning', { name: windowName })}</DialogDescription>
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
