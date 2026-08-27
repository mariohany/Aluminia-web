import { useParams, useOutletContext } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppWindow, Copy, DoorOpen, Fan, Folder, Pencil, Trash2 } from 'lucide-react'
import { GlassKind } from '@repo/types/windows'
import type { WindowSummary } from '@repo/types/windows'
import { WindowThumbnail } from '@/components/workspace/window-thumbnail'
import { useClientTreeQuery } from '@/lib/clients-queries'
import { useDuplicateWindowMutation, useWindowsQuery } from '@/lib/windows-queries'
import { useMergedGlassCombinationsQuery, useMergedGlassQuery, useMergedSystemProfilesQuery } from '@/lib/lookup-merge'
import { displayName } from '@/lib/bilingual'
import { apiErrorMessage } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

interface CanvasOutletContext {
  openEditWindow: (id: string) => void
  openDeleteWindow: (id: string, name: string) => void
}

/**
 * The canvas — the window designer's future home.
 *
 * A project with windows shows them as cards; the visual designer that
 * will eventually let you draw one is still a later phase. A project
 * with none yet, and the client/nothing-selected states, keep the
 * original honest empty state: a graph-paper grid and a message naming
 * what's missing, rather than a mock of a designer the code can't keep.
 *
 * The grid is drawn with CSS gradients rather than an image asset, so
 * it costs nothing to load: white background, light gray lines, two
 * densities layered (fine + a bolder line every 6th cell).
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
  const { openEditWindow, openDeleteWindow } = useOutletContext<CanvasOutletContext>()

  // Same query key as the tree in WorkspaceLayout, so this reads the
  // existing cache rather than firing a second network request — just
  // enough to show the selected client's own name here.
  const treeQuery = useClientTreeQuery()
  const selectedClient = clientId ? treeQuery.data?.find((c) => c.id === clientId) : undefined

  const windowsQuery = useWindowsQuery(projectId)
  const windows = windowsQuery.data ?? []
  const hasWindows = !windowsQuery.isLoading && windows.length > 0

  const duplicateMutation = useDuplicateWindowMutation(projectId ?? '')
  const onDuplicate = (id: string) => {
    duplicateMutation.mutate(
      { id, copySuffix: t('canvas.copySuffix') },
      { onError: (err) => toast.error(apiErrorMessage(err, t('canvas.duplicateError'))) },
    )
  }

  const title = projectId
    ? t('canvas.noWindowsTitle')
    : selectedClient
      ? displayName(selectedClient, language)
      : t('canvas.nothingSelected')

  const hint = projectId
    ? t('canvas.noWindowsHint')
    : selectedClient
      ? t('canvas.clientSelectedHint')
      : t('canvas.nothingSelectedHint')

  const Icon = selectedClient && !projectId ? Folder : AppWindow

  return (
    <div
      className="relative h-full w-full overflow-y-auto"
      style={{
        backgroundColor: '#ffffff',
        backgroundImage: [
          'linear-gradient(to right, rgba(0,0,0,0.12) 1px, transparent 1px)',
          'linear-gradient(to bottom, rgba(0,0,0,0.12) 1px, transparent 1px)',
          'linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px)',
          'linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '120px 120px, 120px 120px, 20px 20px, 20px 20px',
      }}
    >
      {projectId && hasWindows ? (
        // `pt-20` (not `p-6` on top) clears the floating toolbar
        // (`WorkspaceToolbar`, `absolute top-0`) — otherwise the first
        // row of cards renders directly under it.
        //
        // auto-fill rather than a fixed column count: cards stay compact
        // at any canvas width instead of each stretching to a third of
        // the screen, and more of them fit on one view.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 px-6 pt-20 pb-6">
          {windows.map((w) => (
            <WindowCard
              key={w.id}
              window={w}
              onEdit={() => openEditWindow(w.id)}
              onDuplicate={() => onDuplicate(w.id)}
              onDelete={() => openDeleteWindow(w.id, w.name)}
            />
          ))}
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-xl border border-border bg-card/90 p-6 text-center shadow-sm">
            <Icon className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function WindowCard({
  window: w,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  window: WindowSummary
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('workspace')
  const profilesQuery = useMergedSystemProfilesQuery()
  const glassQuery = useMergedGlassQuery()
  const combinationsQuery = useMergedGlassCombinationsQuery()

  const frame = profilesQuery.data?.find((p) => `${p.scope}:${p.id}` === w.frameProfile)
  const glassName =
    w.glassKind === GlassKind.SINGLE
      ? glassQuery.data?.find((g) => `${g.scope}:${g.id}` === w.glass)?.name
      : combinationsQuery.data?.find((c) => `${c.scope}:${c.id}` === w.glass)?.name

  return (
    <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-sm backdrop-blur">
      {/* The elevation leads — it says what this window IS faster than
          the three lines under it do. Fixed height so a grid of cards
          stays on a rhythm regardless of each window's proportions; the
          SVG letterboxes itself inside. */}
      <div className="flex h-40 items-center justify-center border-b border-border bg-muted/30 p-2">
        <WindowThumbnail panels={w.panels} className="h-full w-full" />
      </div>

      <div className="flex flex-col gap-1 p-3">
        {/* Name and the actions share the top line; the detail lines run
            the card's full width underneath. At this column width there
            isn't room for three buttons alongside four lines of text —
            "1400 × 1600 mm · ×1" wraps the moment it has to share. */}
        <div className="flex items-start justify-between gap-1">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{w.name}</p>
          <div className="-me-1 -mt-1 flex shrink-0">
            <Button variant="ghost" size="icon" className="size-6" aria-label={t('actions.edit')} onClick={onEdit}>
              <Pencil className="size-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t('actions.duplicate')}
              title={t('actions.duplicate')}
              onClick={onDuplicate}
            >
              <Copy className="size-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label={t('actions.delete')}
              onClick={onDelete}
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <p className="truncate text-xs text-muted-foreground" dir="ltr">
          {w.widthMm} × {w.heightMm} mm · ×{w.quantity}
        </p>
        {frame && <p className="truncate text-xs text-muted-foreground">{frame.profileNo}</p>}
        {glassName && <p className="truncate text-xs text-muted-foreground">{glassName}</p>}
        {/* No panel-count chip: the drawing above already shows how many
            panels there are, and a number repeating the picture is
            noise. Door/fly-screen stay because they're the FIRST panel's
            flags and aren't always readable at this size. */}
        {(w.isDoor || w.hasFlyScreen) && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {w.isDoor && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                <DoorOpen className="size-3" aria-hidden="true" />
                {t('fields.isDoor')}
              </span>
            )}
            {w.hasFlyScreen && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                <Fan className="size-3" aria-hidden="true" />
                {t('fields.hasFlyScreen')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
