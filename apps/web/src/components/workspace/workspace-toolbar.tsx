import { useTranslation } from 'react-i18next'
import { FolderPlus, Pencil, PencilRuler } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The floating toolbar over the canvas: new client, new project, edit
 * selected. Creation lives here; the properties panel only reads.
 */
export function WorkspaceToolbar({
  hasSelection,
  onNewClient,
  onNewProject,
  onEdit,
}: {
  hasSelection: boolean
  onNewClient: () => void
  onNewProject: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation('workspace')

  return (
    <div className="absolute inset-inline-start-0 top-0 z-10 m-3 flex gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
      <Button variant="ghost" size="icon" aria-label={t('actions.newClient')} title={t('actions.newClient')} onClick={onNewClient}>
        <FolderPlus className="size-5" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('actions.newProject')} title={t('actions.newProject')} onClick={onNewProject}>
        <PencilRuler className="size-5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        // Disabled rather than hidden: a control that vanishes is harder
        // to learn than one that is visibly unavailable.
        disabled={!hasSelection}
        aria-label={t('actions.editProject')}
        title={t('actions.editProject')}
        onClick={onEdit}
      >
        <Pencil className="size-5" aria-hidden="true" />
      </Button>
    </div>
  )
}
