import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface WindowIssueRow {
  /** `null` for a row that points at no part (the assembly-level note,
   * the "illustration only" caption) — rendered as plain text rather
   * than a click-to-select button. */
  partId: string | null
  severity: 'error' | 'warning' | 'info'
  message: string
}

const STORAGE_KEY = 'aluminia.windowEditor.issuesPanel'
const HEADER_PX = 32
const DEFAULT_PX = 132
const MIN_EXPANDED_PX = HEADER_PX + 40
// Dragging below this collapses to the header bar instead of leaving a
// sliver of list too short to read a single row.
const COLLAPSE_BELOW_PX = HEADER_PX + 24
const KEYBOARD_STEP_PX = 16

function maxHeightPx(): number {
  return Math.max(MIN_EXPANDED_PX, Math.round(window.innerHeight * 0.5))
}

function clampHeight(px: number): number {
  return Math.min(maxHeightPx(), Math.max(MIN_EXPANDED_PX, Math.round(px)))
}

function readStored(): { heightPx: number; collapsed: boolean } {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { heightPx?: unknown; collapsed?: unknown } | null
    return {
      heightPx: typeof parsed?.heightPx === 'number' ? clampHeight(parsed.heightPx) : DEFAULT_PX,
      collapsed: parsed?.collapsed === true,
    }
  } catch {
    return { heightPx: DEFAULT_PX, collapsed: false }
  }
}

/**
 * The window editor's warnings/errors, docked under the drawing at a
 * FIXED height (Mario, 2026-10-02: "when showing any warning or error in
 * the bottom of window editor it shakes the screen"). The old strip only
 * existed while there were messages and grew as they wrapped, so every
 * message appearing/clearing resized the drawing's box and the SVG
 * rescaled to fit. This panel is always there — "No issues" when empty —
 * and only changes size when the user drags its top edge or collapses
 * it, never because of its content; a long list scrolls instead. A new
 * error while collapsed only recolours the header counts, it does not
 * pop the panel open. Height + collapsed state persist per browser.
 */
export function WindowIssuesPanel({ rows, onSelectPart }: { rows: WindowIssueRow[]; onSelectPart: (partId: string) => void }) {
  const { t } = useTranslation('workspace')
  const [{ heightPx, collapsed }, setState] = useState(readStored)
  const drag = useRef<{ startY: number; startHeight: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ heightPx, collapsed }))
    } catch {
      // Storage blocked (private mode, quota) — the panel still works,
      // it just won't remember.
    }
  }, [heightPx, collapsed])

  const resizeTo = (px: number) =>
    setState((prev) =>
      px < COLLAPSE_BELOW_PX ? { ...prev, collapsed: true } : { heightPx: clampHeight(px), collapsed: false },
    )

  const onHandlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY, startHeight: collapsed ? HEADER_PX : heightPx }
  }
  const onHandlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    // Dragging UP grows the panel — its top edge is the one that moves.
    resizeTo(drag.current.startHeight + (drag.current.startY - e.clientY))
  }
  const onHandlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const onHandleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = collapsed ? HEADER_PX : heightPx
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      resizeTo(Math.max(current + KEYBOARD_STEP_PX, collapsed ? MIN_EXPANDED_PX : 0))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      resizeTo(current - KEYBOARD_STEP_PX)
    }
  }

  const errorCount = rows.filter((r) => r.severity === 'error').length
  const warningCount = rows.filter((r) => r.severity === 'warning').length
  const noteCount = rows.filter((r) => r.severity === 'info').length
  const problemCount = errorCount + warningCount

  return (
    <section
      aria-label={t('windowDialog.design.issuesPanel.title')}
      className="relative flex shrink-0 flex-col border-t border-border bg-background"
      style={{ height: collapsed ? HEADER_PX : heightPx }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('windowDialog.design.issuesPanel.resize')}
        aria-valuemin={HEADER_PX}
        aria-valuemax={maxHeightPx()}
        aria-valuenow={collapsed ? HEADER_PX : heightPx}
        tabIndex={0}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        onKeyDown={onHandleKeyDown}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none outline-none after:absolute after:inset-x-0 after:top-1 after:h-px after:bg-transparent hover:after:bg-primary focus-visible:after:bg-primary"
      />
      <button
        type="button"
        onClick={() => setState((prev) => ({ ...prev, collapsed: !prev.collapsed }))}
        aria-expanded={!collapsed}
        className="flex shrink-0 items-center gap-3 px-1 text-xs"
        style={{ height: HEADER_PX }}
      >
        <span className="font-medium">{t('windowDialog.design.issuesPanel.title')}</span>
        {problemCount === 0 ? (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
            <CheckCircle2 className="size-3.5" aria-hidden />
            {t('windowDialog.design.issuesPanel.none')}
          </span>
        ) : (
          <>
            {errorCount > 0 && (
              <span className="flex items-center gap-1 font-medium text-destructive">
                <XCircle className="size-3.5" aria-hidden />
                {t('windowDialog.design.issuesPanel.errors', { count: errorCount })}
              </span>
            )}
            {warningCount > 0 && (
              <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-500">
                <AlertTriangle className="size-3.5" aria-hidden />
                {t('windowDialog.design.issuesPanel.warnings', { count: warningCount })}
              </span>
            )}
          </>
        )}
        {noteCount > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Info className="size-3.5" aria-hidden />
            {t('windowDialog.design.issuesPanel.notes', { count: noteCount })}
          </span>
        )}
        <span className="ms-auto text-muted-foreground">
          {collapsed ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
          <span className="sr-only">
            {collapsed ? t('windowDialog.design.issuesPanel.expand') : t('windowDialog.design.issuesPanel.collapse')}
          </span>
        </span>
      </button>
      {!collapsed && (
        <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-1.5 text-xs">
          {rows.map((row) => {
            const Icon = row.severity === 'error' ? XCircle : row.severity === 'warning' ? AlertTriangle : Info
            const tone =
              row.severity === 'error'
                ? 'text-destructive'
                : row.severity === 'warning'
                  ? 'text-amber-600 dark:text-amber-500'
                  : 'text-muted-foreground'
            return (
              <li key={`${row.partId ?? ''}:${row.message}`} className={cn('flex items-start gap-1.5 py-0.5', tone)}>
                <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
                {row.partId ? (
                  <button
                    type="button"
                    onClick={() => onSelectPart(row.partId as string)}
                    className="text-start underline decoration-dotted underline-offset-2"
                  >
                    {row.message}
                  </button>
                ) : (
                  <span>{row.message}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
