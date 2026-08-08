import { useMemo, useState } from 'react'
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Folder, MoreHorizontal, PencilRuler } from 'lucide-react'
import type { ClientWithProjects } from '@repo/types/clients'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { displayName } from '@/lib/bilingual'

interface ProjectTreeProps {
  clients: ClientWithProjects[]
  isLoading: boolean
  onNavigate?: () => void
  onEditClient: (client: ClientWithProjects) => void
  onDeleteClient: (client: ClientWithProjects) => void
}

/**
 * The workspace's navigation: clients as folders, projects as their
 * children. This tree *is* the navigation and *is* the filter — there
 * is no clients list page and no separate project list.
 *
 * Selection lives in the URL, not in state here, so a project is
 * linkable and survives a refresh. `NavLink` reads it back.
 */
export function ProjectTree({
  clients,
  isLoading,
  onNavigate,
  onEditClient,
  onDeleteClient,
}: ProjectTreeProps) {
  const { t, i18n } = useTranslation('workspace')
  const language = i18n.resolvedLanguage ?? 'en'
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

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

  if (isLoading) {
    return <p className="p-2 text-sm text-muted-foreground">{t('tree.loading')}</p>
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('tree.searchPlaceholder')}
        aria-label={t('tree.searchPlaceholder')}
      />

      {clients.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{t('tree.empty')}</p>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{t('tree.noMatches')}</p>
      ) : (
        <ul className="-mx-1 flex-1 overflow-y-auto" role="tree">
          {filtered.map((client) => {
            const isCollapsed = !searching && collapsed[client.id]
            return (
              <li key={client.id} role="treeitem" aria-expanded={!isCollapsed}>
                <div className="group flex items-center rounded-md">
                  {/* Disclosure is its own control, separate from
                      selection: clicking the name selects and navigates
                      the client (like a project row), clicking the
                      chevron only expands or collapses. Conflating the
                      two — as an earlier version did — meant there was
                      no way to select a client without also toggling
                      its children shut. */}
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [client.id]: !prev[client.id] }))
                    }
                    className="flex shrink-0 items-center rounded-md p-1.5 text-foreground hover:bg-accent"
                    aria-label={isCollapsed ? t('tree.expand') : t('tree.collapse')}
                  >
                    {/* Chevron direction is a reading-order decision, not
                        a geometric one: pointing "forward" means right
                        in English and left in Arabic. RTL flips it. */}
                    {isCollapsed ? (
                      <ChevronRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                    )}
                  </button>

                  <NavLink
                    to={`/workspace/clients/${client.id}`}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pe-2 text-sm font-medium',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground group-hover:bg-accent',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Folder
                          className={cn('size-4 shrink-0', isActive ? '' : 'text-muted-foreground')}
                          aria-hidden="true"
                        />
                        <span className="truncate">{displayName(client, language)}</span>
                      </>
                    )}
                  </NavLink>

                  {/* Clients are edited and deleted from here rather than
                      the canvas toolbar, which acts on the selected
                      PROJECT. Kept visible on focus as well as hover, so
                      it is reachable by keyboard. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="me-1 size-7 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label={t('tree.clientActions', { name: displayName(client, language) })}
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEditClient(client)}>
                        {t('actions.editClient')}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => onDeleteClient(client)}>
                        {t('actions.deleteClient')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {!isCollapsed && (
                  <ul role="group">
                    {client.projects.length === 0 ? (
                      <li className="ps-9 pe-2 py-1 text-xs text-muted-foreground">
                        {t('tree.noProjects')}
                      </li>
                    ) : (
                      client.projects.map((project) => (
                        <li key={project.id} role="treeitem">
                          <NavLink
                            to={`/workspace/projects/${project.id}`}
                            onClick={onNavigate}
                            className={({ isActive }) =>
                              cn(
                                // ps-* is logical: indentation flips with
                                // the writing direction rather than
                                // needing a second rule for RTL.
                                'flex items-center gap-1.5 rounded-md ps-9 pe-2 py-1.5 text-sm',
                                isActive
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-foreground hover:bg-accent',
                              )
                            }
                          >
                            <PencilRuler className="size-4 shrink-0" aria-hidden="true" />
                            <span className="truncate">{displayName(project, language)}</span>
                          </NavLink>
                        </li>
                      ))
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
