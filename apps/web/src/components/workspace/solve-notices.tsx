import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dismissSolve, solveErrorKey, useLocalSolves } from '@/lib/solve/solve-manager'

/**
 * A bar optimiser report this tab was making finished or failed while the
 * user worked elsewhere (docs/browser_solve_planing.md B3, Q2: the rail's
 * Reports icon shows it running; this card only says how it ended). A
 * ready notice goes after a few seconds (solve-manager), a failure stays
 * until dismissed or opened. Not shown on that report's own page, which
 * says the same thing itself. Bottom-end corner, like the toasts.
 */
export function SolveNotices() {
  const { t } = useTranslation('reports')
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const notices = [...useLocalSolves().values()].filter(
    (solve) =>
      (solve.state === 'done' || solve.state === 'failed') &&
      !pathname.startsWith(`/workspace/reports/projects/${solve.projectId}`),
  )
  if (!notices.length) return null

  return (
    <div className="pointer-events-none fixed end-4 bottom-4 z-40 flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2">
      {notices.map((solve) => {
        const failed = solve.state === 'failed'
        const open = () => {
          if (!failed) dismissSolve(solve.projectId)
          void navigate(`/workspace/reports/projects/${solve.projectId}/bar-optimiser`)
        }
        return (
          <div
            key={solve.projectId}
            role={failed ? 'alert' : 'status'}
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border bg-card p-3 shadow-lg"
          >
            {failed ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="truncate text-[13px] font-semibold" dir="auto">
                {solve.projectName}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {failed ? t(solveErrorKey(solve.error)) : t('notice.ready')}
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-7" onClick={open}>
              {t('notice.open')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('solve.dismiss')}
              onClick={() => dismissSolve(solve.projectId)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
