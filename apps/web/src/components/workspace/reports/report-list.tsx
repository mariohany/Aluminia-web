import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { REPORTS } from '@/lib/report-kinds'
import { cn } from '@/lib/utils'

export function ReportList({ projectId, selected }: { projectId: string; selected: string | undefined }) {
  const { t } = useTranslation('reports')
  return (
    <ul className="flex flex-col gap-1">
      {REPORTS.map(({ key, slug, icon: Icon }) => {
        const isSelected = !!slug && slug === selected
        const body = (
          <>
            <span
              className={cn(
                'flex size-7.5 shrink-0 items-center justify-center rounded-lg',
                isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <span className="min-w-0 truncate">{t(`kinds.${key}.name`)}</span>
                {!slug && (
                  <span className="ms-auto shrink-0 rounded-full bg-muted px-1.5 py-px text-[10.5px] font-normal text-muted-foreground">
                    {t('list.later')}
                  </span>
                )}
              </span>
              <span className="text-[11.5px] text-muted-foreground">{t(`kinds.${key}.description`)}</span>
            </span>
          </>
        )
        const rowClass = cn(
          'flex gap-2.5 rounded-lg border p-2.5 text-start',
          isSelected ? 'border-primary bg-primary/10' : 'border-border',
        )
        return (
          <li key={key}>
            {slug ? (
              <Link
                to={`/workspace/reports/projects/${projectId}/${slug}`}
                aria-current={isSelected ? 'page' : undefined}
                className={cn(rowClass, !isSelected && 'hover:bg-accent')}
              >
                {body}
              </Link>
            ) : (
              <div aria-disabled="true" className={cn(rowClass, 'text-muted-foreground opacity-75')}>
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
