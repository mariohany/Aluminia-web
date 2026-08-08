import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Folder, PencilRuler } from 'lucide-react'
import { useClientTreeQuery } from '@/lib/clients-queries'
import { displayName } from '@/lib/bilingual'

/**
 * The canvas — the window designer's future home.
 *
 * Deliberately empty in this phase. It shows a graph-paper grid and an
 * honest empty state naming what will live here, rather than a mock of
 * a designer that doesn't exist: a fake preview is a promise the code
 * can't keep, and it makes the gap harder to see rather than easier.
 *
 * The grid is drawn with a CSS gradient rather than an image asset, so
 * it costs nothing to load and adapts to the theme's border colour.
 *
 * Reads whichever of `projectId` / `clientId` the current route
 * declares — both are selectable in the tree, and each gets its own
 * honest empty state rather than the page claiming "nothing selected"
 * while the tree shows otherwise.
 */
export function CanvasPage() {
  const { t, i18n } = useTranslation('workspace')
  const { projectId, clientId } = useParams()
  const language = i18n.resolvedLanguage ?? 'en'

  // Same query key as the tree in WorkspaceLayout, so this reads the
  // existing cache rather than firing a second network request — just
  // enough to show the selected client's own name here.
  const treeQuery = useClientTreeQuery()
  const selectedClient = clientId ? treeQuery.data?.find((c) => c.id === clientId) : undefined

  const title = projectId
    ? t('canvas.designerComing')
    : selectedClient
      ? displayName(selectedClient, language)
      : t('canvas.nothingSelected')

  const hint = projectId
    ? t('canvas.designerHint')
    : selectedClient
      ? t('canvas.clientSelectedHint')
      : t('canvas.nothingSelectedHint')

  const Icon = selectedClient && !projectId ? Folder : PencilRuler

  return (
    <div
      className="relative h-full w-full"
      style={{
        backgroundImage:
          'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div className="max-w-sm rounded-xl border border-border bg-card/90 p-6 text-center shadow-sm">
          <Icon className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
        </div>
      </div>
    </div>
  )
}
