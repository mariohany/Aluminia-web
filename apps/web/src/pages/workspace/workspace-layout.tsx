import { useState } from 'react'
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import type { ClientWithProjects } from '@repo/types/clients'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { WorkspaceRail } from '@/components/workspace/workspace-rail'
import { ProjectTree } from '@/components/workspace/project-tree'
import { WorkspaceToolbar } from '@/components/workspace/workspace-toolbar'
import { PropertiesPanel } from '@/components/workspace/properties-panel'
import { ClientDialog } from '@/components/workspace/client-dialog'
import { ProjectDialog } from '@/components/workspace/project-dialog'
import { DeleteClientDialog, DeleteProjectDialog } from '@/components/workspace/delete-dialogs'
import { LanguageSwitcher } from '@/components/language-switcher'
import { useClientTreeQuery } from '@/lib/clients-queries'
import { useProjectQuery } from '@/lib/projects-queries'
import { displayName } from '@/lib/bilingual'
import { isRtlLanguage } from '@/lib/i18n'

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
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  // The layout is not the route that declares `:projectId`/`:clientId`,
  // so it reads the selection back off the path rather than from
  // params. Selection lives in the URL so a project or client is
  // linkable and survives a refresh. Only one of the two is ever set —
  // they're siblings under /workspace, not nested.
  const projectMatch = useMatch('/workspace/projects/:projectId')
  const selectedProjectId = projectMatch?.params.projectId
  const clientMatch = useMatch('/workspace/clients/:clientId')
  const selectedClientId = clientMatch?.params.clientId

  // The toolbar and properties panel act on the Projects section —
  // they create/edit/select clients and projects. `Manage` replaces the
  // tree's CONTENT area entirely rather than sitting beside it (see
  // §3), so both must be suppressed there. Without this the toolbar's
  // absolute positioning floats on top of the Manage page regardless of
  // what it renders underneath.
  const { pathname } = useLocation()
  const onManage = pathname.startsWith('/workspace/manage')

  // Loaded once here, at the shell, rather than per page: the tree is
  // permanent chrome, so a page-level fetch would refetch it on every
  // navigation between projects.
  const treeQuery = useClientTreeQuery()
  const projectQuery = useProjectQuery(selectedProjectId)
  const clients = treeQuery.data ?? []

  const [clientDialogOpen, setClientDialogOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<ClientWithProjects | undefined>()
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [editingProject, setEditingProject] = useState(false)
  const [deletingClient, setDeletingClient] = useState<ClientWithProjects | undefined>()
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)

  // The Sheet primitive only understands physical sides, so this one
  // spot translates direction by hand — unlike the layout itself, which
  // mirrors through logical properties. Opens from the reading start
  // edge: left in English, right in Arabic.
  const mobileSheetSide = isRtlLanguage(language) ? 'right' : 'left'

  // What "New project" should default its client to: the client that's
  // directly selected, or — if a project is selected instead — that
  // project's own client. Either way the toolbar button starts from
  // wherever the user is already looking, rather than an empty picker.
  const contextClientId = selectedClientId ?? (selectedProjectId ? projectQuery.data?.clientId : undefined)

  const openNewProject = () => {
    setEditingProject(false)
    setProjectDialogOpen(true)
  }

  const openEditProject = () => {
    if (!selectedProjectId) return
    setEditingProject(true)
    setProjectDialogOpen(true)
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
    />
  )

  return (
    <div className="flex h-svh overflow-hidden">
      <div className="hidden md:flex">
        <WorkspaceRail />
      </div>

      {/* The tree panel: flush against the rail and canvas, divided by a
          border rather than floating as an inset card — matching the
          admin sidebar's own treatment (`admin-layout.tsx`). */}
      <aside className="hidden w-72 shrink-0 border-e border-border bg-background p-3 lg:block">
        {tree()}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 lg:justify-end">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('openMenu')}>
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side={mobileSheetSide} className="flex w-80 gap-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{t('openMenu')}</SheetTitle>
              </SheetHeader>
              <WorkspaceRail onNavigate={() => setMobileOpen(false)} />
              <div className="min-w-0 flex-1 p-3">{tree(() => setMobileOpen(false))}</div>
            </SheetContent>
          </Sheet>

          <LanguageSwitcher />
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1 overflow-y-auto">
            {!onManage && (
              <WorkspaceToolbar
                hasSelection={!!selectedProjectId}
                onNewClient={() => {
                  setEditingClient(undefined)
                  setClientDialogOpen(true)
                }}
                onNewProject={openNewProject}
                onEdit={openEditProject}
              />
            )}
            <Outlet />
          </main>

          {!onManage && (
            <div className="hidden lg:flex">
              <PropertiesPanel
                project={selectedProjectId ? projectQuery.data : undefined}
                isLoading={!!selectedProjectId && projectQuery.isLoading}
                onEdit={openEditProject}
                onDelete={() => setDeleteProjectOpen(true)}
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
            if (lostSelection) void navigate('/workspace')
          }}
        />
      )}

      {selectedProjectId && projectQuery.data && (
        <DeleteProjectDialog
          projectId={selectedProjectId}
          projectName={displayName(projectQuery.data, language)}
          open={deleteProjectOpen}
          onOpenChange={setDeleteProjectOpen}
          onDeleted={() => void navigate('/workspace')}
        />
      )}
    </div>
  )
}
