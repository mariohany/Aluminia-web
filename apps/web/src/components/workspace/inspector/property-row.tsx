import { Label } from '@/components/ui/label'
import { IssueList } from '@/components/workspace/issue-list'
import type { TranslatedIssue } from '@/lib/window-weight'

/**
 * One *label · value* line of the property sheet —
 * docs/inspector_redesign_planing.md §1. The label column is fixed so
 * every value in a group starts at the same place; the row's own issues
 * (or a plain error string) show underneath, aligned with the value.
 */
export function PropertyRow({
  label,
  htmlFor,
  required = false,
  issues = [],
  error,
  hint,
  children,
}: {
  label: string
  /** The control's id — omit for a read-only value (the label is then
   * plain text, not a <label>). */
  htmlFor?: string
  required?: boolean
  issues?: TranslatedIssue[]
  error?: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  const labelText = (
    <span>
      {label}
      {required && (
        <span className="ms-0.5 text-destructive" aria-hidden="true">
          *
        </span>
      )}
    </span>
  )
  const below = error || hint || issues.length > 0
  return (
    <div className="flex flex-col">
      <div className="flex min-h-8.5 items-center gap-2">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="w-24 shrink-0 text-[12.5px] font-normal text-muted-foreground">
            {labelText}
          </Label>
        ) : (
          <span className="w-24 shrink-0 text-[12.5px] text-muted-foreground">{labelText}</span>
        )}
        <div className="flex min-w-0 flex-1 items-center">{children}</div>
      </div>
      {below && (
        <div className="flex flex-col gap-1 ps-26 pb-1">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          <IssueList issues={issues} />
        </div>
      )}
    </div>
  )
}

/** A read-only value in a row — `24 mm · max 32`, `Hinged · Alumil S67`. */
export function PropertyText({ mono = true, children }: { mono?: boolean; children: React.ReactNode }) {
  return <span className={mono ? 'px-2 font-mono text-[12.5px]' : 'px-2 text-[12.5px]'}>{children}</span>
}
