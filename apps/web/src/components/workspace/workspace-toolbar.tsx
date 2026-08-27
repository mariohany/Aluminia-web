import { useTranslation } from 'react-i18next'
import { FolderPlus, Pencil, PencilRuler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WindowPaneIcon } from '@/components/icons/window-pane-icon'

/**
 * The floating toolbar over the canvas: new client, new project, new
 * window, edit selected. Creation lives here; the properties panel only
 * reads.
 */
export function WorkspaceToolbar({
  hasSelection,
  hasProjectSelection,
  onNewClient,
  onNewProject,
  onNewWindow,
  onEdit,
}: {
  hasSelection: boolean
  /** A project (not just a client) is selected — windows need a project. */
  hasProjectSelection: boolean
  onNewClient: () => void
  onNewProject: () => void
  onNewWindow: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation('workspace')

  return (
    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
      <Button variant="ghost" size="icon" aria-label={t('actions.newClient')} title={t('actions.newClient')} onClick={onNewClient}>
        <FolderPlus className="size-5" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('actions.newProject')} title={t('actions.newProject')} onClick={onNewProject}>
        <PencilRuler className="size-5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={!hasProjectSelection}
        aria-label={t('actions.newWindow')}
        title={t('actions.newWindow')}
        onClick={onNewWindow}
      >
        <WindowPaneIcon className="size-5" aria-hidden="true" />
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
