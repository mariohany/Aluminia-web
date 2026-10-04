import { useCallback, useMemo, useRef, useState } from 'react'

/** One undoable step — docs/editor_undo_redo_planing.md §1. `before`/
 * `after` are whole snapshots of what the user edits; `view` is where
 * they were (selection, active panel…) when the step STARTED, restored
 * on both undo and redo (decision 2). `labelKey` names the step in the
 * tool pill's tooltip. */
export interface HistoryStep<S, V, L extends string = string> {
  labelKey: L
  before: S
  after: S
  view: V
}

/** Structural equality over plain data (objects, arrays, primitives) —
 * `Object.is` at the leaves so a brand-new panel's `NaN` sizes compare
 * equal to themselves, same as react-hook-form's own `deepEqual`. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every(
    (key) => Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

/**
 * Undo/redo history for a screen whose edits all pass through a few
 * known "doors" (the window editor: `commitPanels` + four `setValue`
 * fields). Knows nothing about forms — the caller snapshots before/after
 * and applies whatever `undo()`/`redo()` hand back.
 *
 * A GESTURE (§3) is an open merge window: while one is open, every
 * `record` only moves its step's `after`, so a whole drag or a field's
 * typing lands as one step. A gesture that ends where it began leaves
 * no step behind.
 *
 * Lives in component state on purpose: unmounting the editor (save or
 * leave) is what ends the history — nothing to clear by hand.
 */
export function useEditHistory<S, V, L extends string = string>(limit = 100) {
  const past = useRef<HistoryStep<S, V, L>[]>([])
  const future = useRef<HistoryStep<S, V, L>[]>([])
  const gesture = useRef<{ key: string; step: HistoryStep<S, V, L> | null; isActive?: () => boolean } | null>(null)
  // The stacks are refs (so a burst of drag frames never waits on a
  // render); this counter is only what makes the pill re-render.
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const endGesture = useCallback(
    (key?: string) => {
      const open = gesture.current
      if (!open || (key !== undefined && open.key !== key)) return
      gesture.current = null
      if (open.step && sameValue(open.step.before, open.step.after) && past.current.at(-1) === open.step) {
        past.current.pop()
        bump()
      }
    },
    [bump],
  )

  /** `isActive` lets a gesture notice its own end when no end event
   * can arrive — a focused input unmounted mid-typing fires no blur. */
  const beginGesture = useCallback(
    (key: string, isActive?: () => boolean) => {
      if (gesture.current?.key === key) return
      // Backstop for a gesture whose end never arrived (§ Risks).
      endGesture()
      gesture.current = { key, step: null, isActive }
    },
    [endGesture],
  )

  const record = useCallback(
    (labelKey: L, before: S, after: S, view: V) => {
      if (gesture.current?.isActive && !gesture.current.isActive()) endGesture()
      // A different action inside one gesture (Enter in a field that
      // also submits something else) is never merged — it starts the
      // gesture's next step instead.
      if (gesture.current?.step && gesture.current.step.labelKey !== labelKey) gesture.current.step = null
      const open = gesture.current
      if (open?.step) {
        open.step.after = after
        future.current = []
        bump()
        return
      }
      if (sameValue(before, after)) return
      const step: HistoryStep<S, V, L> = { labelKey, before, after, view }
      past.current.push(step)
      if (past.current.length > limit) past.current.shift()
      future.current = []
      if (open) open.step = step
      bump()
    },
    [bump, endGesture, limit],
  )

  const undo = useCallback((): HistoryStep<S, V, L> | null => {
    endGesture()
    const step = past.current.pop()
    if (!step) return null
    future.current.push(step)
    bump()
    return step
  }, [bump, endGesture])

  const redo = useCallback((): HistoryStep<S, V, L> | null => {
    endGesture()
    const step = future.current.pop()
    if (!step) return null
    past.current.push(step)
    bump()
    return step
  }, [bump, endGesture])

  return useMemo(
    () => ({
      record,
      beginGesture,
      endGesture,
      undo,
      redo,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      undoLabelKey: past.current.at(-1)?.labelKey ?? null,
      redoLabelKey: future.current.at(-1)?.labelKey ?? null,
    }),
    // `version` is what invalidates the derived fields above — the
    // stacks themselves are refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, beginGesture, endGesture, undo, redo, version],
  )
}
