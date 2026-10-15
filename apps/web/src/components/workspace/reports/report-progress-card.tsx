import { useTranslation } from 'react-i18next'
import { Circle, CircleCheck, LoaderCircle } from 'lucide-react'
import type { ReportProgressGroup } from '@repo/types/reports'
import { cn } from '@/lib/utils'

/** The background run's progress, one line per member group
 * (docs/reports_planing.md D22). Once every group is done the job is
 * writing the PDF. */
export function ReportProgressCard({ groups }: { groups: ReportProgressGroup[] }) {
  const { t } = useTranslation('reports')
  const writingPdf = groups.length > 0 && groups.every((g) => g.state === 'done')

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-[min(380px,calc(100%-2rem))] flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-lg"
    >
      <p className="text-sm font-semibold">{t('progress.title')}</p>
      <ul className="flex flex-col gap-2">
        {groups.map((group) => (
          <li key={group.member} className="flex items-center gap-2.5 text-[13px]">
            {group.state === 'done' ? (
              <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ) : group.state === 'running' ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className={cn('flex-1', group.state === 'waiting' && 'text-muted-foreground')}>
              {t(`members.${group.member}`)}
            </span>
            <span className="font-mono text-[11.5px] text-muted-foreground" dir="auto">
              {group.state === 'done'
                ? t('progress.done', { count: group.profilesTotal })
                : group.state === 'running'
                  ? t('progress.running', {
                      done: group.profilesDone,
                      total: group.profilesTotal,
                      profile: group.currentProfile ?? '',
                    })
                  : t('progress.waiting')}
            </span>
          </li>
        ))}
      </ul>
      {writingPdf && (
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          {t('progress.rendering')}
        </p>
      )}
      <p className="text-[11.5px] text-muted-foreground">{t('progress.note')}</p>
    </div>
  )
}
