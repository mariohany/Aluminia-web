import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from '@/components/error-boundary'
import { ProjectTree } from '@/components/workspace/project-tree'
import { BarOptimiserView } from '@/components/workspace/reports/bar-optimiser-view'
import { ReportList } from '@/components/workspace/reports/report-list'
import { REPORTS } from '@/lib/report-kinds'
import { displayName } from '@/lib/bilingual'
import { useClientTreeQuery } from '@/lib/clients-queries'
import type { ClientWithProjects } from '@repo/types/clients'

const NO_CLIENTS: ClientWithProjects[] = []

/**
 * The Reports section (docs/reports_planing.md §9, D18; mock-up
 * `rep-chosen` on the design canvas): the company's projects by client,
 * the selected project's reports, and the open report. Project and
 * report live in the URL (`/workspace/reports/projects/:projectId/
 * :report`) so a refresh keeps both.
 */
export function ReportsPage() {
  const { t, i18n } = useTranslation('reports')
  const language = i18n.resolvedLanguage ?? 'en'
  const { projectId, report } = useParams()
  const navigate = useNavigate()
  const treeQuery = useClientTreeQuery()
  const clients = treeQuery.data ?? NO_CLIENTS
  const selected = findProject(clients, projectId)

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-68 shrink-0 overflow-hidden border-e border-border bg-card px-2.5 py-4 lg:block">
        <ProjectTree
          readOnly
          title={t('tree.title')}
          clients={clients}
          isLoading={treeQuery.isLoading}
          selectedProjectId={projectId}
          projectPath={(id) => `/workspace/reports/projects/${id}${report ? `/${report}` : ''}`}
        />
      </aside>

      <aside className="hidden w-62 shrink-0 flex-col gap-2.5 overflow-y-auto border-e border-border bg-card px-2.5 py-4 md:flex">
        <div className="flex flex-col gap-0.5 px-1">
          <h2 className="text-sm font-semibold">{t('list.title')}</h2>
          {selected && (
            <span className="truncate text-[11.5px] text-muted-foreground">
              {displayName(selected.client, language)} › {displayName(selected.project, language)}
            </span>
          )}
        </div>
        {projectId ? (
          <ReportList projectId={projectId} selected={report} />
        ) : (
          <p className="px-1 text-[13px] text-muted-foreground">{t('list.pickProject')}</p>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {/* Below `lg` the tree becomes a project picker; below `md` the
            report list becomes a second one. */}
        <div className="flex flex-wrap gap-2 border-b border-border bg-card px-4 py-2.5 lg:hidden">
          <select
            aria-label={t('tree.title')}
            value={projectId ?? ''}
            onChange={(event) =>
              void navigate(
                event.target.value
                  ? `/workspace/reports/projects/${event.target.value}${report ? `/${report}` : ''}`
                  : '/workspace/reports',
              )
            }
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{t('tree.title')}</option>
            {clients.map((client) => (
              <optgroup key={client.id} label={displayName(client, language)}>
                {client.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {displayName(project, language)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {projectId && (
            // The report list column shows from `md` up.
            <select
              aria-label={t('list.title')}
              value={report ?? ''}
              onChange={(event) =>
                void navigate(`/workspace/reports/projects/${projectId}${event.target.value ? `/${event.target.value}` : ''}`)
              }
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm md:hidden"
            >
              <option value="">{t('list.title')}</option>
              {REPORTS.filter((r) => r.slug).map((r) => (
                <option key={r.key} value={r.slug!}>
                  {t(`kinds.${r.key}.name`)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {!projectId ? (
            <Empty text={t('empty.noProject')} />
          ) : report === 'bar-optimiser' ? (
            // A failing report keeps the tree and list usable; picking
            // another project clears it (the key remounts the boundary).
            <ErrorBoundary key={projectId} variant="section">
              <BarOptimiserView
                projectId={projectId}
                projectName={selected ? displayName(selected.project, language) : ''}
                clientName={selected ? displayName(selected.client, language) : ''}
              />
            </ErrorBoundary>
          ) : (
            <Empty text={t('empty.noReport')} />
          )}
        </div>
      </section>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6" style={{ backgroundColor: 'var(--board)' }}>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

function findProject(clients: ClientWithProjects[], projectId: string | undefined) {
  for (const client of clients) {
    const project = client.projects.find((p) => p.id === projectId)
    if (project) return { client, project }
  }
  return null
}
