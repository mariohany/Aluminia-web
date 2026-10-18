import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import type { ProjectDetail } from '@repo/types/projects'
import type { ProjectStatusEvent } from '@repo/types/project-settings'
import { useAuth } from '@/lib/auth-context'
import { displayName } from '@/lib/bilingual'
import { useProjectStatusHistoryQuery } from '@/lib/projects-queries'
import { useProjectStatusesQuery } from '@/lib/project-settings-queries'
import { cn } from '@/lib/utils'
import { ResponsibleAvatars, StatusChip, StatusDot } from '@/components/workspace/status/project-status'

/** History shows this many events until "Show all" (Q7: the newest
 * first, so the current status is always the top line). */
const HISTORY_PREVIEW = 3

/**
 * The project panel's Status and History sections
 * (docs/project_settings_planing.md S10, S11, board `ps-status-a`).
 * Read-only: moving between statuses is a later plan. Name, colour, step
 * and responsible users come from the statuses list, so a Config edit
 * shows here without refetching the project.
 */
export function ProjectStatusSections({ project }: { project: ProjectDetail }) {
  const { t, i18n } = useTranslation('workspace')
  const { user } = useAuth()
  const statuses = useProjectStatusesQuery()
  const status = statuses.data?.find((s) => s.id === project.statusId)
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })

  return (
    <>
      <section className="flex flex-col gap-3 border-b border-border px-4 py-3.5">
        <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          {t('properties.status.title')}
        </h3>
        {!status ? (
          <span className="text-xs text-muted-foreground">
            {statuses.isError ? t('properties.status.loadError') : t('tree.loading')}
          </span>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip name={displayName(status, i18n.language)} color={status.color} />
              <span className="text-[11.5px] text-muted-foreground">
                {t('properties.status.step', {
                  position: status.position,
                  count: statuses.data?.length ?? 0,
                  since: dateFormat.format(new Date(project.statusSince)),
                })}
              </span>
            </div>
            {status.responsible.length > 0 ? (
              <div className="flex min-w-0 items-center gap-2">
                <ResponsibleAvatars users={status.responsible} />
                <span className="min-w-0 truncate text-[12.5px] text-foreground" dir="ltr">
                  {status.responsible.map((u) => u.email.split('@')[0]).join(', ')}
                </span>
                <span className="shrink-0 text-[12.5px] text-muted-foreground">
                  {t('properties.status.responsible')}
                </span>
              </div>
            ) : (
              <div role="alert" className="flex gap-2 rounded-lg bg-destructive/10 px-2.5 py-2">
                <TriangleAlert className="mt-px size-4 shrink-0 text-destructive" aria-hidden="true" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[12.5px] font-semibold text-destructive">
                    {t('properties.status.nobody', { name: displayName(status, i18n.language) })}
                  </span>
                  {user?.role === UserRole.COMPANY_ADMIN ? (
                    <Link
                      to="/workspace/config/projects"
                      className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {t('properties.status.nobodyAdmin')}
                    </Link>
                  ) : (
                    <span className="text-[11.5px] text-muted-foreground">{t('properties.status.nobodyUser')}</span>
                  )}
                </span>
              </div>
            )}
          </>
        )}
      </section>
      <HistorySection projectId={project.id} />
    </>
  )
}

function HistorySection({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('workspace')
  const history = useProjectStatusHistoryQuery(projectId)
  const [showAll, setShowAll] = useState(false)
  const events = history.data ?? []
  const shown = showAll ? events : events.slice(0, HISTORY_PREVIEW)
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-3.5">
      <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        {t('properties.status.history')}
      </h3>
      {history.isLoading && <span className="text-xs text-muted-foreground">{t('tree.loading')}</span>}
      {history.isError && <span className="text-xs text-destructive">{t('properties.status.historyError')}</span>}
      {shown.length > 0 && (
        <ol className="flex flex-col">
          {shown.map((event, index) => (
            <HistoryItem
              key={event.id}
              event={event}
              last={index === shown.length - 1}
              when={dateFormat.format(new Date(event.at))}
            />
          ))}
        </ol>
      )}
      {events.length > HISTORY_PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="self-start rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {showAll ? t('properties.status.showLess') : t('properties.status.showAll', { count: events.length })}
        </button>
      )}
    </section>
  )
}

function HistoryItem({ event, last, when }: { event: ProjectStatusEvent; last: boolean; when: string }) {
  const { t, i18n } = useTranslation('workspace')
  const who = event.byUserEmail?.split('@')[0]
  const what = event.fromStatusId === null ? t('properties.status.created') : null
  return (
    <li className="grid grid-cols-[14px_minmax(0,1fr)] gap-2.5">
      <span className="flex flex-col items-center" aria-hidden="true">
        <StatusDot color={event.color} className="mt-1 size-[9px]" />
        {!last && <span className="my-0.5 w-px flex-1 bg-border" />}
      </span>
      <span className={cn('flex min-w-0 flex-col gap-px', !last && 'pb-2.5')}>
        <span className="truncate text-[12.5px] font-semibold text-foreground">
          {displayName(event, i18n.language)}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          {[who, what, when].filter(Boolean).join(' · ')}
        </span>
      </span>
    </li>
  )
}
