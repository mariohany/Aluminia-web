import type { TranslatedIssue } from '@/lib/window-weight'
import { cn } from '@/lib/utils'

/** The part panel's per-field issue lines — pulled out of
 * window-part-panel.tsx so the sliding layout editor can show each
 * sash's own issues under its row without importing the whole panel
 * (which imports it back). */
export function IssueList({ issues }: { issues: TranslatedIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue, i) => (
        <li
          key={i}
          className={cn(
            'text-xs',
            issue.severity === 'error' ? 'text-destructive' : 'font-medium text-amber-600 dark:text-amber-500',
          )}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  )
}
