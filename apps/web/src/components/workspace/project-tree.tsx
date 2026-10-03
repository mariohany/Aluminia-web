import { useMemo, useRef, useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Folder, FolderPlus, PencilRuler, Plus } from 'lucide-react'
import type { ClientWithProjects } from '@repo/types/clients'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { displayName } from '@/lib/bilingual'

interface ProjectTreeProps {
  clients: ClientWithProjects[]
  isLoading: boolean
  onNavigate?: () => void
  /** The header's two create buttons (docs/workspace_redesign_planing.md §1). */
  onNewClient: () => void
  onNewProject: () => void
  onEditClient: (client: ClientWithProjects) => void
  onDeleteClient: (client: ClientWithProjects) => void
  /**
   * Act on whichever project is currently selected — same as the
   * properties panel's edit/delete buttons. Safe to call right after a
   * right-click because the row's context menu selects the project (see
   * `ContextMenu`'s `onOpenChange` below) before either can fire.
   */
  onEditProject: () => void
  onEditProjectPreferences: () => void
  onDeleteProject: () => void
}

/**
 * The workspace's navigation: clients as folders, projects as their
 * children. This tree *is* the navigation and *is* the filter — there
 * is no clients list page and no separate project list.
 *
 * Selection lives in the URL, not in state here, so a project is
 * linkable and survives a refresh. `NavLink` reads it back.
 *
 * Its own header carries New client / New project — they used to live
 * on the canvas's floating toolbar (workspace redesign §1).
 */
export function ProjectTree({
  clients,
  isLoading,
  onNavigate,
  onNewClient,
  onNewProject,
  onEditClient,
  onDeleteClient,
  onEditProject,
  onEditProjectPreferences,
  onDeleteProject,
}: ProjectTreeProps) {
  const { t, i18n } = useTranslation('workspace')
  const language = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Arrow-key navigation moves real DOM focus between rows rather than
  // tracking a "focused row" in state — every row's NavLink is already
  // a natively focusable element in document order, so there is
  // nothing to keep in sync: `document.activeElement` is the single
  // source of truth for "which row". `data-tree-row` marks the set to
  // move between; it only ever contains currently-visible rows, since
  // a collapsed client's projects aren't rendered at all.
  //
  // Moving also selects: `.click()` runs the exact same NavLink
  // navigation a mouse click would, so the row arrow lands on isn't
  // just focused, it's the one actually shown on the canvas — arrow
  // keys behave like a listbox's selection move, not a treeview's
  // separate "focus vs. activate" split.
  const treeRef = useRef<HTMLUListElement>(null)

  const focusAdjacentRow = (current: HTMLElement, delta: 1 | -1) => {
    const rows = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? [])
    const next = rows[rows.indexOf(current) + delta]
    next?.focus()
    next?.click()
  }

  const focusClientRow = (clientId: string) => {
    const row = treeRef.current?.querySelector<HTMLElement>(`[data-client-row="${clientId}"]`)
    row?.focus()
    row?.click()
  }

  // Both read here rather than left to NavLink's own per-element
  // isActive render prop: the client row's highlight has to cover the
  // whole row (chevron included), and Radix's `asChild`/Slot — used by
  // both rows' right-click menu — mishandles a function-valued
  // `className` (merges it as a string, corrupting it into the
  // function's stringified source), so the project row needs a plain
  // string className too.
  const clientMatch = useMatch('/workspace/clients/:clientId')
  const selectedClientId = clientMatch?.params.clientId
  const projectMatch = useMatch('/workspace/projects/:projectId')
  const selectedProjectId = projectMatch?.params.projectId

  // Filtered client-side against the already-loaded tree: the whole tree
  // arrives in one request, so a round trip per keystroke would buy
  // nothing. Matches EITHER language regardless of the active one —
  // someone searching "Nile" should find a client displayed in Arabic.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return clients

    const matches = (value: string | null) => !!value && value.toLowerCase().includes(term)

    return clients
      .map((client) => {
        const clientMatches = matches(client.enName) || matches(client.arName)
        // A matching client keeps all its projects; otherwise only the
        // projects that match themselves.
        const projects = clientMatches
          ? client.projects
          : client.projects.filter((p) => matches(p.enName) || matches(p.arName))
        return { ...client, projects, keep: clientMatches || projects.length > 0 }
      })
      .filter((client) => client.keep)
  }, [clients, search])

  // While searching, a collapsed client would hide the very match that
  // kept it in the list.
  const searching = search.trim().length > 0

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-sm font-semibold text-foreground">{t('tree.clientsTitle')}</h2>
        {!isLoading && <span className="font-mono text-[11px] text-muted-foreground">{clients.length}</span>}
        <span className="flex-1" />
        <Button
          variant="outline"
          size="icon"
          className="size-7.5"
          aria-label={t('actions.newClient')}
          title={t('actions.newClient')}
          onClick={onNewClient}
        >
          <FolderPlus className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-7.5"
          aria-label={t('actions.newProject')}
          title={t('actions.newProject')}
          onClick={onNewProject}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('tree.searchPlaceholder')}
        aria-label={t('tree.searchPlaceholder')}
      />

      {isLoading ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{t('tree.loading')}</p>
      ) : clients.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{t('tree.empty')}</p>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{t('tree.noMatches')}</p>
      ) : (
        <ul ref={treeRef} className="flex flex-1 flex-col gap-px overflow-y-auto" role="tree">
          {filtered.map((client) => {
            const isCollapsed = !searching && collapsed[client.id]
            const isActive = client.id === selectedClientId
            const toggleCollapsed = () =>
              setCollapsed((prev) => ({ ...prev, [client.id]: !prev[client.id] }))
            return (
              <li key={client.id} role="treeitem" aria-expanded={!isCollapsed}>
                {/* Edit/delete moved from a "…" button to a right-click
                    menu, so the row's own highlight (see below) doesn't
                    have to make room for a persistent control. Opening
                    the menu also selects the row — same as a left-click
                    — so right-clicking a client you weren't already
                    looking at doesn't act on the wrong one. */}
                <ContextMenu
                  onOpenChange={(open) => {
                    if (open) void navigate(`/workspace/clients/${client.id}`)
                  }}
                >
                  <ContextMenuTrigger asChild>
                    {/* The highlight lives on this row, not the NavLink
                        inside it, so a selected client's background
                        covers the chevron too — the same full-row
                        treatment a project row gets from being one
                        NavLink. */}
                    <div
                      className={cn(
                        'group flex h-8 items-center rounded-md',
                        // Primary tint, not a solid fill — same selected
                        // treatment as the admin sidebar's nav links.
                        isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
                      )}
                      // Same toggle as the chevron, just reachable from
                      // anywhere on the row — a faster way to drill in
                      // than aiming for the small chevron hit target.
                      onDoubleClick={toggleCollapsed}
                    >
                      {/* Disclosure is its own control, separate from
                          selection: clicking the name selects and
                          navigates the client (like a project row),
                          clicking the chevron only expands or collapses.
                          Conflating the two — as an earlier version did
                          — meant there was no way to select a client
                          without also toggling its children shut. */}
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsed((prev) => ({ ...prev, [client.id]: !prev[client.id] }))
                        }
                        className="flex shrink-0 items-center rounded-md p-1.5 text-muted-foreground"
                        aria-label={isCollapsed ? t('tree.expand') : t('tree.collapse')}
                      >
                        {/* Chevron direction is a reading-order decision,
                            not a geometric one: pointing "forward" means
                            right in English and left in Arabic. RTL
                            flips it. */}
                        {isCollapsed ? (
                          <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                        )}
                      </button>

                      <NavLink
                        to={`/workspace/clients/${client.id}`}
                        onClick={onNavigate}
                        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pe-2 text-[13px] font-medium"
                        data-tree-row
                        data-client-row={client.id}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            focusAdjacentRow(event.currentTarget, 1)
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            focusAdjacentRow(event.currentTarget, -1)
                          } else if (event.key === 'ArrowRight') {
                            event.preventDefault()
                            // Closed: open it, focus stays put. Already
                            // open: move into its first project, same
                            // two-step feel as a native file explorer.
                            if (isCollapsed) {
                              setCollapsed((prev) => ({ ...prev, [client.id]: false }))
                            } else {
                              focusAdjacentRow(event.currentTarget, 1)
                            }
                          } else if (event.key === 'ArrowLeft' && !isCollapsed) {
                            event.preventDefault()
                            setCollapsed((prev) => ({ ...prev, [client.id]: true }))
                          }
                        }}
                      >
                        <Folder
                          className={cn('size-4 shrink-0', isActive ? '' : 'text-muted-foreground')}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{displayName(client, language)}</span>
                      </NavLink>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => onEditClient(client)}>
                      {t('actions.editClient')}
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onSelect={() => onDeleteClient(client)}>
                      {t('actions.deleteClient')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>

                {!isCollapsed && (
                  <ul role="group">
                    {client.projects.length === 0 ? (
                      <li className="ps-9 pe-2 py-1 text-xs text-muted-foreground">
                        {t('tree.noProjects')}
                      </li>
                    ) : (
                      client.projects.map((project) => {
                        const isProjectActive = project.id === selectedProjectId
                        return (
                          <li key={project.id} role="treeitem">
                            <ContextMenu
                              onOpenChange={(open) => {
                                if (open) void navigate(`/workspace/projects/${project.id}`)
                              }}
                            >
                              <ContextMenuTrigger asChild>
                                <NavLink
                                  to={`/workspace/projects/${project.id}`}
                                  onClick={onNavigate}
                                  className={cn(
                                    // ps-* is logical: indentation flips with
                                    // the writing direction rather than
                                    // needing a second rule for RTL.
                                    'flex h-8 items-center gap-1.5 rounded-md ps-9 pe-2 text-[13px]',
                                    isProjectActive
                                      ? 'bg-primary/10 font-semibold text-primary'
                                      : 'text-foreground hover:bg-accent',
                                  )}
                                  data-tree-row
                                  onKeyDown={(event) => {
                                    if (event.key === 'ArrowDown') {
                                      event.preventDefault()
                                      focusAdjacentRow(event.currentTarget, 1)
                                    } else if (event.key === 'ArrowUp') {
                                      event.preventDefault()
                                      focusAdjacentRow(event.currentTarget, -1)
                                    } else if (event.key === 'ArrowLeft') {
                                      // Collapses the parent client and
                                      // moves focus there — same as a
                                      // native file explorer's "left
                                      // arrow steps out to the folder".
                                      event.preventDefault()
                                      setCollapsed((prev) => ({ ...prev, [client.id]: true }))
                                      focusClientRow(client.id)
                                    }
                                  }}
                                >
                                  <PencilRuler
                                    className={cn(
                                      'size-3.5 shrink-0',
                                      isProjectActive ? '' : 'text-muted-foreground',
                                    )}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">{displayName(project, language)}</span>
                                </NavLink>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem onSelect={onEditProject}>
                                  {t('actions.editProject')}
                                </ContextMenuItem>
                                <ContextMenuItem onSelect={onEditProjectPreferences}>
                                  {t('actions.editPreferences')}
                                </ContextMenuItem>
                                <ContextMenuItem variant="destructive" onSelect={onDeleteProject}>
                                  {t('actions.deleteProject')}
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          </li>
                        )
                      })
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
