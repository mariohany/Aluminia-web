import { useMemo, useState } from 'react'
import { useParams, useOutletContext } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AppWindow,
  ArrowUpDown,
  Copy,
  DoorOpen,
  Fan,
  Folder,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { GlassKind } from '@repo/types/windows'
import type { WindowSummary } from '@repo/types/windows'
import { WindowThumbnail } from '@/components/workspace/window-thumbnail'
import { useClientTreeQuery } from '@/lib/clients-queries'
import { useProjectQuery } from '@/lib/projects-queries'
import { useDuplicateWindowMutation, useWindowsQuery } from '@/lib/windows-queries'
import { useMergedGlassCombinationsQuery, useMergedGlassQuery, useMergedSystemProfilesQuery } from '@/lib/lookup-merge'
import { useWindowIssues } from '@/lib/window-render'
import { displayName } from '@/lib/bilingual'
import { apiErrorMessage } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface CanvasOutletContext {
  openNewWindow: () => void
  openEditWindow: (id: string) => void
  openDeleteWindow: (id: string, name: string) => void
}

// Workspace redesign §2 (Mario, 2026-10-04): "created" is the API's own
// order, i.e. no sort at all. Not remembered across reloads.
const SORT_KEYS = ['created', 'name', 'size', 'quantity'] as const
type SortKey = (typeof SORT_KEYS)[number]

function sortWindows(windows: WindowSummary[], key: SortKey, locale: string): WindowSummary[] {
  if (key === 'created') return windows
  const sorted = [...windows]
  if (key === 'name') {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
    sorted.sort((a, b) => collator.compare(a.name, b.name))
  } else if (key === 'size') {
    // Largest first — the big openings are usually the ones being checked.
    sorted.sort((a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm)
  } else {
    sorted.sort((a, b) => b.quantity - a.quantity)
  }
  return sorted
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
  const { openNewWindow, openEditWindow, openDeleteWindow } = useOutletContext<CanvasOutletContext>()

  // Same query key as the tree in WorkspaceLayout, so this reads the
  // existing cache rather than firing a second network request — just
  // enough to show the selected client's own name here.
  const treeQuery = useClientTreeQuery()
  const selectedClient = clientId ? treeQuery.data?.find((c) => c.id === clientId) : undefined
  // Same cache the layout's properties panel already reads.
  const projectQuery = useProjectQuery(projectId)
  const project = projectQuery.data
  const projectClient = project ? treeQuery.data?.find((c) => c.id === project.clientId) : undefined

  const windowsQuery = useWindowsQuery(projectId)
  const windows = useMemo(() => windowsQuery.data ?? [], [windowsQuery.data])
  const hasWindows = !windowsQuery.isLoading && windows.length > 0
  const units = windows.reduce((sum, w) => sum + w.quantity, 0)

  // Search + sort (workspace redesign §2): client-side, over the list
  // the board already has.
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('created')
  const visibleWindows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matching = term ? windows.filter((w) => w.name.toLowerCase().includes(term)) : windows
    return sortWindows(matching, sortKey, language)
  }, [windows, search, sortKey, language])

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

  // The graph-paper grid is the empty-canvas motif (nothing drawn yet) —
  // once real window cards fill the canvas, the grid lines showing
  // through/between them read as visual noise rather than a design
  // surface, so cards get a plain white background instead (Mario,
  // 2026-09-16: "remove the grid background behined the window cards").
  const showGrid = !(projectId && hasWindows)

  return (
    <div
      className="relative h-full w-full overflow-y-auto"
      style={
        showGrid
          ? {
              // `--board*` theme tokens (index.css): graph paper on the shell
              // grey in light, Graphite in dark.
              backgroundColor: 'var(--board)',
              backgroundImage: [
                'linear-gradient(to right, var(--board-grid-major) 1px, transparent 1px)',
                'linear-gradient(to bottom, var(--board-grid-major) 1px, transparent 1px)',
                'linear-gradient(to right, var(--board-grid-minor) 1px, transparent 1px)',
                'linear-gradient(to bottom, var(--board-grid-minor) 1px, transparent 1px)',
              ].join(', '),
              backgroundSize: '120px 120px, 120px 120px, 20px 20px, 20px 20px',
            }
          : { backgroundColor: 'var(--board)' }
      }
    >
      {projectId && project && (
        // Top-start label: which client and project the board shows, and
        // how much is on it. Units = every window's quantity summed.
        <div className="absolute start-6 top-5 z-10 flex flex-col leading-snug">
          {projectClient && (
            <span className="text-xs text-muted-foreground">{displayName(projectClient, language)}</span>
          )}
          <span className="text-base font-semibold text-foreground">{displayName(project, language)}</span>
          {hasWindows && (
            <span className="text-xs text-muted-foreground">
              {t('canvas.windowCount', { count: windows.length })} · {t('canvas.unitCount', { count: units })}
            </span>
          )}
        </div>
      )}

      {/* The floating pill — the window editor's tool-pill treatment.
          Replaces the old four-icon toolbar: New client / New project
          moved to the tree header, Edit to the properties panel. */}
      <div className="absolute start-1/2 top-3.5 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-[10px] border border-border bg-card p-1 shadow-lg rtl:translate-x-1/2">
        <Button size="sm" className="h-8" disabled={!projectId} onClick={openNewWindow}>
          <Plus className="size-4" aria-hidden="true" />
          {t('actions.newWindow')}
        </Button>
        {hasWindows && (
          <>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {searchOpen || search ? (
              <SearchInput
                icon
                autoFocus
                value={search}
                onChange={setSearch}
                placeholder={t('canvas.searchPlaceholder')}
                aria-label={t('canvas.searchPlaceholder')}
                className="w-52 [&_input]:h-8"
                onBlur={() => setSearchOpen(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearch('')
                    setSearchOpen(false)
                  }
                }}
              />
            ) : (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('canvas.searchPlaceholder')}
                title={t('canvas.searchPlaceholder')}
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-4" aria-hidden="true" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('canvas.sort.label')}
                  title={t('canvas.sort.label')}
                  className={sortKey !== 'created' ? 'text-primary' : undefined}
                >
                  <ArrowUpDown className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>{t('canvas.sort.label')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  {SORT_KEYS.map((key) => (
                    <DropdownMenuRadioItem key={key} value={key}>
                      {t(`canvas.sort.${key}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {projectId && hasWindows ? (
        visibleWindows.length === 0 ? (
          <p className="px-6 pt-28 text-sm text-muted-foreground">{t('canvas.noMatches')}</p>
        ) : (
        // `pt-24` clears the label and the floating pill above the grid.
        //
        // auto-fill rather than a fixed column count: cards stay compact
        // at any canvas width instead of each stretching to a third of
        // the screen, and more of them fit on one view.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3.5 px-6 pt-24 pb-6">
          {visibleWindows.map((w) => (
            <WindowCard
              key={w.id}
              window={w}
              onEdit={() => openEditWindow(w.id)}
              onDuplicate={() => onDuplicate(w.id)}
              onDelete={() => openDeleteWindow(w.id, w.name)}
            />
          ))}
        </div>
        )
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

  // Same `error`-severity rules the design dialog's own issue strip
  // enforces (a fixed section missing its bead profile, a dangling
  // profile/glass reference, etc.) — a nudge to open and fix, not a
  // duplicate of every warning shown inside the editor.
  const hasErrors = useWindowIssues(w.panels).length > 0

  return (
    // Double-click opens the editor (Mario, 2026-10-04 — a single click
    // does nothing, so the ⋯ menu can't open it by accident). Focusable
    // with Enter as the keyboard equivalent, so it isn't mouse-only.
    <article
      tabIndex={0}
      aria-label={w.name}
      onDoubleClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault()
          onEdit()
        }
      }}
      className="relative flex cursor-default flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-shadow outline-none select-none hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {hasErrors && (
        <div
          className="absolute end-2 top-2 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-white"
          title={t('canvas.windowHasErrors')}
        >
          <TriangleAlert className="size-3" aria-hidden="true" />
        </div>
      )}
      {/* The elevation leads — it says what this window IS faster than
          the three lines under it do. Fixed height so a grid of cards
          stays on a rhythm regardless of each window's proportions; the
          SVG letterboxes itself inside. */}
      <div className="flex h-38 items-center justify-center border-b border-border bg-muted/40 p-2">
        <WindowThumbnail panels={w.panels} className="h-full w-full" />
      </div>

      <div className="flex flex-col gap-[3px] px-3 pt-2.5 pb-3">
        {/* Name and the ⋯ menu share the top line; the detail lines run
            the card's full width underneath. */}
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{w.name}</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-me-1.5 size-6 shrink-0"
                aria-label={t('canvas.windowActions')}
                title={t('canvas.windowActions')}
                // The card's own double-click must not fire from here.
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil aria-hidden="true" />
                {t('actions.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy aria-hidden="true" />
                {t('actions.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 aria-hidden="true" />
                {t('actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p className="truncate font-mono text-[11.5px] text-muted-foreground" dir="ltr">
          {w.widthMm} × {w.heightMm} mm · ×{w.quantity}
        </p>
        {(frame || glassName) && (
          <p className="truncate text-[11.5px] text-muted-foreground">
            {[frame?.profileNo, glassName].filter(Boolean).join(' · ')}
          </p>
        )}
        {/* No panel-count chip: the drawing above already shows how many
            panels there are, and a number repeating the picture is
            noise. Door/fly-screen stay because they're the FIRST panel's
            flags and aren't always readable at this size. */}
        {(w.isDoor || w.hasFlyScreen) && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {w.isDoor && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <DoorOpen className="size-3" aria-hidden="true" />
                {t('fields.isDoor')}
              </span>
            )}
            {w.hasFlyScreen && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Fan className="size-3" aria-hidden="true" />
                {t('fields.hasFlyScreen')}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
