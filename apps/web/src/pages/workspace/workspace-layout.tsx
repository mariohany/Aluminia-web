import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { ClientWithProjects } from '@repo/types/clients'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { WorkspaceRail } from '@/components/workspace/workspace-rail'
import { ProjectTree } from '@/components/workspace/project-tree'
import { WorkspaceToolbar } from '@/components/workspace/workspace-toolbar'
import { PropertiesPanel } from '@/components/workspace/properties-panel'
import { ClientDialog } from '@/components/workspace/client-dialog'
import { ProjectDialog } from '@/components/workspace/project-dialog'
import { DeleteClientDialog, DeleteProjectDialog, DeleteWindowDialog } from '@/components/workspace/delete-dialogs'
import { useClientTreeQuery } from '@/lib/clients-queries'
import { useProjectQuery } from '@/lib/projects-queries'
import { isRtlLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Stable reference so the keyboard-delete effect below doesn't see a
// "new" clients array (and re-subscribe its listener) on every render
// before the tree query has data.
const EMPTY_CLIENTS: ClientWithProjects[] = []

const TREE_WIDTH_STORAGE_KEY = 'aluminia.workspace.treeWidth'
const DEFAULT_TREE_WIDTH = 288 // matches the old static w-72
const MIN_TREE_WIDTH = 224 // 14rem — the floor it can shrink to; it never collapses to hidden
const MAX_TREE_WIDTH = 480
const TREE_WIDTH_STEP = 16 // px per arrow-key press when resizing via keyboard

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function readStoredTreeWidth() {
  const raw = localStorage.getItem(TREE_WIDTH_STORAGE_KEY)
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? clamp(parsed, MIN_TREE_WIDTH, MAX_TREE_WIDTH) : DEFAULT_TREE_WIDTH
}

// Selection lives in the URL (see the comment below), but the URL
// itself is forgotten the moment the user navigates to Manage or lands
// on the bare `/workspace` root — this is what lets a return trip put
// them back where they were instead of an empty canvas.
const LAST_SELECTION_STORAGE_KEY = 'aluminia.workspace.lastSelection'

type LastSelection = { type: 'client' | 'project'; id: string }

function readLastSelection(): LastSelection | null {
  try {
    const raw = localStorage.getItem(LAST_SELECTION_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      ((parsed as LastSelection).type === 'client' || (parsed as LastSelection).type === 'project') &&
      typeof (parsed as LastSelection).id === 'string'
    ) {
      return parsed as LastSelection
    }
  } catch {
    // Malformed or foreign value under this key — treat as absent.
  }
  return null
}

/**
 * The workspace shell — a persistent frame, not a page.
 *
 * The canvas is where the window designer will live, which is the whole
 * reason this is a shell rather than the table-based layout the admin
 * console uses. Building it now means the designer drops into an
 * existing frame instead of replacing a screen.
 *
 * Dialogs and the properties panel live HERE rather than in the canvas
 * page, because both are driven by the tree and the URL, which this
 * component already owns. Pushing them down would mean lifting the same
 * state back up again.
 *
 * Everything is laid out with logical properties (`border-e`, `ps-*`)
 * rather than left/right, so Arabic mirrors the whole layout
 * structurally: rail to the right edge, tree beside it, canvas last.
 */
export function WorkspaceLayout() {
  const { t, i18n } = useTranslation('workspace')
  const language = i18n.resolvedLanguage ?? 'en'
  const rtl = isRtlLanguage(language)
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const [treeWidth, setTreeWidth] = useState(readStoredTreeWidth)
  const [isResizingTree, setIsResizingTree] = useState(false)
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    localStorage.setItem(TREE_WIDTH_STORAGE_KEY, String(treeWidth))
  }, [treeWidth])

  // Dragging is tracked via window listeners (not onPointerMove on the
  // handle) so the drag keeps tracking even when the pointer leaves the
  // thin handle itself mid-move.
  useEffect(() => {
    if (!isResizingTree) return

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeStateRef.current) return
      const dx = event.clientX - resizeStateRef.current.startX
      // In RTL the panel's drag edge is visually on the left (flex row
      // mirrors under dir="rtl"), so growing it means dragging left.
      const signedDx = rtl ? -dx : dx
      setTreeWidth(clamp(resizeStateRef.current.startWidth + signedDx, MIN_TREE_WIDTH, MAX_TREE_WIDTH))
    }

    const stopResizing = () => {
      resizeStateRef.current = null
      setIsResizingTree(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingTree, rtl])

  const handleResizePointerDown = (event: React.PointerEvent) => {
    resizeStateRef.current = { startX: event.clientX, startWidth: treeWidth }
    setIsResizingTree(true)
  }

  const handleResizeKeyDown = (event: React.KeyboardEvent) => {
    // "Forward" grows the panel in reading order — same left/right flip
    // as the tree's own chevron under RTL.
    const growKey = rtl ? 'ArrowLeft' : 'ArrowRight'
    const shrinkKey = rtl ? 'ArrowRight' : 'ArrowLeft'
    if (event.key === growKey) {
      event.preventDefault()
      setTreeWidth((width) => clamp(width + TREE_WIDTH_STEP, MIN_TREE_WIDTH, MAX_TREE_WIDTH))
    } else if (event.key === shrinkKey) {
      event.preventDefault()
      setTreeWidth((width) => clamp(width - TREE_WIDTH_STEP, MIN_TREE_WIDTH, MAX_TREE_WIDTH))
    }
  }

  // The layout is not the route that declares `:projectId`/`:clientId`,
  // so it reads the selection back off the path rather than from
  // params. Selection lives in the URL so a project or client is
  // linkable and survives a refresh. Only one of the two is ever set —
  // they're siblings under /workspace, not nested.
  const projectMatch = useMatch('/workspace/projects/:projectId')
  const selectedProjectId = projectMatch?.params.projectId
  const clientMatch = useMatch('/workspace/clients/:clientId')
  const selectedClientId = clientMatch?.params.clientId

  // The tree, toolbar, and properties panel all act on the Projects
  // section — they create/edit/select clients and projects. `Manage`
  // and `Data` each replace the tree's CONTENT area entirely rather
  // than sitting beside it (see §3), so all three must be suppressed on
  // both. Without this the toolbar's absolute positioning floats on top
  // of whatever those pages render underneath — exactly what happened
  // when Data first shipped without being added here.
  const { pathname } = useLocation()
  const onManage = pathname.startsWith('/workspace/manage')
  const onData = pathname.startsWith('/workspace/data')
  const outsideProjectsSection = onManage || onData

  // Loaded once here, at the shell, rather than per page: the tree is
  // permanent chrome, so a page-level fetch would refetch it on every
  // navigation between projects.
  const treeQuery = useClientTreeQuery()
  const projectQuery = useProjectQuery(selectedProjectId)
  const clients = treeQuery.data ?? EMPTY_CLIENTS

  // Remember whichever of the two is currently selected...
  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem(LAST_SELECTION_STORAGE_KEY, JSON.stringify({ type: 'project', id: selectedProjectId }))
    } else if (selectedClientId) {
      localStorage.setItem(LAST_SELECTION_STORAGE_KEY, JSON.stringify({ type: 'client', id: selectedClientId }))
    }
  }, [selectedProjectId, selectedClientId])

  // ...and restore it on the bare `/workspace` root — reached both by
  // returning from Manage and by the rail's own "Projects" link, which
  // always points there rather than at whatever was last open. Checked
  // against the loaded tree first: a stale id (its client or project
  // got deleted elsewhere, or in another tab) must fall through to the
  // ordinary empty state instead of navigating to a 404.
  useEffect(() => {
    if (pathname !== '/workspace' || treeQuery.isLoading) return

    const last = readLastSelection()
    if (!last) return

    if (last.type === 'project' && clients.some((client) => client.projects.some((p) => p.id === last.id))) {
      void navigate(`/workspace/projects/${last.id}`, { replace: true })
    } else if (last.type === 'client' && clients.some((client) => client.id === last.id)) {
      void navigate(`/workspace/clients/${last.id}`, { replace: true })
    }
  }, [pathname, clients, treeQuery.isLoading, navigate])

  const [clientDialogOpen, setClientDialogOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<ClientWithProjects | undefined>()
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [editingProject, setEditingProject] = useState(false)
  const [projectDialogInitialStep, setProjectDialogInitialStep] = useState<1 | 2>(1)
  const [deletingClient, setDeletingClient] = useState<ClientWithProjects | undefined>()
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)
  const [deletingWindow, setDeletingWindow] = useState<{ id: string; name: string } | undefined>()

  // A selected client or project can be deleted with the keyboard, not
  // only via the tree's right-click menu / properties panel button —
  // both routes open the same confirmation dialog, this just opens it.
  // Bound to both keys: Mac keyboards send "Backspace" for the physical
  // delete key, Windows/Linux forward-delete sends "Delete".
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return

      // Don't hijack the key while the user is typing — a search term,
      // a dialog's confirm-name field, anything editable.
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      // Don't stack a second delete dialog on top of a dialog already
      // open. The window editor no longer needs a guard here — it's a
      // separate route now, not a modal sharing this component's
      // keydown listener.
      if (clientDialogOpen || projectDialogOpen || deletingClient || deleteProjectOpen) return

      if (selectedProjectId && projectQuery.data) {
        event.preventDefault()
        setDeleteProjectOpen(true)
        return
      }

      if (selectedClientId) {
        const client = clients.find((candidate) => candidate.id === selectedClientId)
        if (client) {
          event.preventDefault()
          setDeletingClient(client)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedProjectId,
    selectedClientId,
    clients,
    projectQuery.data,
    clientDialogOpen,
    projectDialogOpen,
    deletingClient,
    deleteProjectOpen,
  ])

  // The Sheet primitive only understands physical sides, so this one
  // spot translates direction by hand — unlike the layout itself, which
  // mirrors through logical properties. Opens from the reading start
  // edge: left in English, right in Arabic.
  const mobileSheetSide = rtl ? 'right' : 'left'

  // What "New project" should default its client to: the client that's
  // directly selected, or — if a project is selected instead — that
  // project's own client. Either way the toolbar button starts from
  // wherever the user is already looking, rather than an empty picker.
  const contextClientId = selectedClientId ?? (selectedProjectId ? projectQuery.data?.clientId : undefined)

  const openNewProject = () => {
    setEditingProject(false)
    setProjectDialogInitialStep(1)
    setProjectDialogOpen(true)
  }

  const openEditProject = () => {
    if (!selectedProjectId) return
    setEditingProject(true)
    setProjectDialogInitialStep(1)
    setProjectDialogOpen(true)
  }

  // Same dialog, opened straight on step 2 — from the properties
  // panel's Preferences section or the tree's right-click menu, neither
  // of which should make the user click through step 1 again.
  const openEditProjectPreferences = () => {
    if (!selectedProjectId) return
    setEditingProject(true)
    setProjectDialogInitialStep(2)
    setProjectDialogOpen(true)
  }

  // The window editor is a full-screen ROUTE now (window-editor-page.tsx),
  // not a dialog this shell owns — these just navigate there.
  const openNewWindow = () => {
    if (!selectedProjectId) return
    void navigate(`/workspace/projects/${selectedProjectId}/windows/new`)
  }

  // Passed down to CanvasPage via Outlet context — its cards need to
  // open the same navigation this layout owns (see the file header
  // comment on why dialogs live here), for the same reason the tree's
  // right-click menu calls back up to these same openers.
  const openEditWindow = (id: string) => {
    if (!selectedProjectId) return
    void navigate(`/workspace/projects/${selectedProjectId}/windows/${id}`)
  }

  const openDeleteWindow = (id: string, name: string) => {
    setDeletingWindow({ id, name })
  }

  // Shared by the tree's right-click menu, the properties panel's
  // delete button, and the keyboard shortcut above.
  const openDeleteProject = () => {
    setDeleteProjectOpen(true)
  }

  const tree = (onNavigate?: () => void) => (
    <ProjectTree
      clients={clients}
      isLoading={treeQuery.isLoading}
      onNavigate={onNavigate}
      onEditClient={(client) => {
        setEditingClient(client)
        setClientDialogOpen(true)
      }}
      onDeleteClient={(client) => setDeletingClient(client)}
      onEditProject={openEditProject}
      onEditProjectPreferences={openEditProjectPreferences}
      onDeleteProject={openDeleteProject}
    />
  )

  return (
    <div className="flex h-svh overflow-hidden">
      {/* No top bar — the rail is the whole persistent chrome, at every
          breakpoint. Below `lg` it also carries the tree's only access
          point, via `onOpenTree`'s Sheet below. */}
      <WorkspaceRail onOpenTree={() => setMobileOpen(true)} />

      {/* The tree panel: flush against the rail and canvas, divided by a
          border rather than floating as an inset card — matching the
          admin sidebar's own treatment (`admin-layout.tsx`). Width is
          user-resizable (drag handle below) rather than a fixed w-72.
          Hidden on Manage and Data, both of which replace the tree's
          content area entirely rather than sitting beside it (see the
          comment on `outsideProjectsSection` above). */}
      {!outsideProjectsSection && (
        <>
          <aside
            style={{ width: treeWidth }}
            className="hidden shrink-0 overflow-hidden border-e border-border bg-background p-3 lg:block"
          >
            {tree()}
          </aside>

          {/* Drag handle: a slim hit area with a 1px line at rest, matching
              the aside's own border-e — so resizing doesn't add visual
              weight beyond what was already there. Placed on the logical
              end edge (not a hardcoded "right") so it stays on the border
              between tree and canvas in both languages, same as every other
              side in this layout. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('tree.resizeLabel')}
            aria-valuenow={Math.round(treeWidth)}
            aria-valuemin={MIN_TREE_WIDTH}
            aria-valuemax={MAX_TREE_WIDTH}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onKeyDown={handleResizeKeyDown}
            className="group hidden w-0.5 shrink-0 cursor-ew-resize touch-none select-none items-center justify-center focus-visible:outline-none lg:flex"
          >
            <div
              className={cn(
                'h-full w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary',
                isResizingTree && 'bg-primary',
              )}
            />
          </div>
        </>
      )}

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side={mobileSheetSide} className="w-80 p-3">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('openMenu')}</SheetTitle>
          </SheetHeader>
          {tree(() => setMobileOpen(false))}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1 overflow-y-auto">
            {!outsideProjectsSection && (
              <WorkspaceToolbar
                hasSelection={!!selectedProjectId}
                hasProjectSelection={!!selectedProjectId}
                onNewClient={() => {
                  setEditingClient(undefined)
                  setClientDialogOpen(true)
                }}
                onNewProject={openNewProject}
                onNewWindow={openNewWindow}
                onEdit={openEditProject}
              />
            )}
            <Outlet context={{ openEditWindow, openDeleteWindow }} />
          </main>

          {!outsideProjectsSection && (
            <div className="hidden lg:flex">
              <PropertiesPanel
                project={selectedProjectId ? projectQuery.data : undefined}
                isLoading={!!selectedProjectId && projectQuery.isLoading}
                onEdit={openEditProject}
                onDelete={openDeleteProject}
              />
            </div>
          )}
        </div>
      </div>

      <ClientDialog
        open={clientDialogOpen}
        onOpenChange={(open) => {
          setClientDialogOpen(open)
          if (!open) setEditingClient(undefined)
        }}
        client={editingClient}
      />

      <ProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        clients={clients}
        language={language}
        project={editingProject ? projectQuery.data : undefined}
        defaultClientId={contextClientId}
        initialStep={projectDialogInitialStep}
        // Selecting the new project immediately is the point of
        // creating it — otherwise the user has to go find it.
        onCreated={(created) => void navigate(`/workspace/projects/${created.id}`)}
      />

      {deletingClient && (
        <DeleteClientDialog
          clientId={deletingClient.id}
          clientName={deletingClient.enName}
          open={!!deletingClient}
          onOpenChange={(open) => !open && setDeletingClient(undefined)}
          // Only deselect if the deletion actually took the current
          // selection with it — either the client itself was selected,
          // or the cascade removed the selected project. Navigating
          // unconditionally would throw away the user's place in the
          // tree for deleting an unrelated client, which is most of the
          // time.
          onDeleted={() => {
            const lostSelection =
              selectedClientId === deletingClient.id ||
              (!!selectedProjectId &&
                deletingClient.projects.some((project) => project.id === selectedProjectId))
            if (lostSelection) {
              // Otherwise the bare-`/workspace` restore effect above
              // would immediately navigate right back to what was just
              // deleted.
              localStorage.removeItem(LAST_SELECTION_STORAGE_KEY)
              void navigate('/workspace')
            }
          }}
        />
      )}

      {selectedProjectId && projectQuery.data && (
        <DeleteProjectDialog
          projectId={selectedProjectId}
          // The English name specifically, typed back — same as
          // DeleteClientDialog uses `enName`, not the bilingual display
          // name, so the confirmation the server checks against is
          // exactly what the user is asked to type.
          projectName={projectQuery.data.enName}
          open={deleteProjectOpen}
          onOpenChange={setDeleteProjectOpen}
          onDeleted={() => {
            localStorage.removeItem(LAST_SELECTION_STORAGE_KEY)
            void navigate('/workspace')
          }}
        />
      )}

      {deletingWindow && selectedProjectId && (
        <DeleteWindowDialog
          windowId={deletingWindow.id}
          windowName={deletingWindow.name}
          projectId={selectedProjectId}
          open={!!deletingWindow}
          onOpenChange={(open) => !open && setDeletingWindow(undefined)}
        />
      )}
    </div>
  )
}
