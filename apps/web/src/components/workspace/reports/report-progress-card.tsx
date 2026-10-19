import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, CircleCheck, Hourglass, LoaderCircle } from 'lucide-react'
import type { ReportProgressGroup } from '@repo/types/reports'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A report on its way (docs/browser_solve_planing.md §8): one line per
 * member group while it solves, in this browser (`solving`, with a timer
 * and Stop) or someone else's (`watching`, B5); then the print
 * (`printing`), queued behind other prints when the server is busy
 * (docs/report_queue_planing.md C4).
 */
export type ReportProgress =
  | { kind: 'solving'; groups: ReportProgressGroup[]; startedAt: number; sending: boolean; onStop: () => void }
  | { kind: 'watching'; groups: ReportProgressGroup[]; email: string | null }
  | { kind: 'printing'; queuePosition: number | null; solvedHere: boolean }

export function ReportProgressCard({ progress }: { progress: ReportProgress }) {
  const { t } = useTranslation('reports')

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-[min(380px,calc(100%-2rem))] flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-lg"
    >
      {progress.kind === 'solving' ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-sm font-semibold">{progress.sending ? t('solve.sending') : t('solve.title')}</p>
          <Elapsed since={progress.startedAt} />
        </div>
      ) : progress.kind === 'watching' ? (
        <p className="text-sm font-semibold" dir="auto">
          {progress.email ? t('solve.titleOther', { email: progress.email }) : t('solve.titleOtherUnknown')}
        </p>
      ) : (
        <>
          {progress.solvedHere && (
            <p className="flex items-center gap-2 text-[13px]">
              <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {t('solve.solved')}
            </p>
          )}
          <p className="flex items-center gap-2 text-sm font-semibold">
            {progress.queuePosition !== null ? (
              <>
                <Hourglass className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {progress.queuePosition
                  ? t('progress.queuedAhead', { count: progress.queuePosition })
                  : t('progress.queuedNext')}
              </>
            ) : (
              <>
                <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
                {t('solve.printing')}
              </>
            )}
          </p>
        </>
      )}

      {progress.kind !== 'printing' && progress.groups.length > 0 && <GroupList groups={progress.groups} />}

      {progress.kind === 'solving' ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[11.5px] text-muted-foreground">{t('solve.note')}</p>
          <Button variant="outline" size="sm" className="h-7" disabled={progress.sending} onClick={progress.onStop}>
            {t('solve.stop')}
          </Button>
        </div>
      ) : (
        <p className="text-[11.5px] text-muted-foreground">
          {progress.kind === 'watching' ? t('solve.noteOther') : t('progress.note')}
        </p>
      )}
    </div>
  )
}

function GroupList({ groups }: { groups: ReportProgressGroup[] }) {
  const { t } = useTranslation('reports')
  return (
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
  )
}

/** m:ss since `since`, ticking every second (B6: no time limit, so the
 * user sees how long it has run). */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <span className="font-mono text-xs text-muted-foreground tabular-nums" dir="ltr">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  )
}
