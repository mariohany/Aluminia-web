import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'

/** A drag box in the container's scrolled content coordinates. */
export interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

// A press that moves less than this is a click on empty space, not a drag.
const DRAG_THRESHOLD_PX = 4
// Dragging this close to the board's top/bottom edge scrolls it.
const AUTOSCROLL_EDGE_PX = 32
const AUTOSCROLL_STEP_PX = 14

// Where a press must NOT start a drag box: on an item, or on any control.
const NO_MARQUEE = '[data-select-id], button, input, textarea, a, [role="menu"], [data-no-marquee]'

function isModifier(event: { metaKey: boolean; ctrlKey: boolean }) {
  return event.metaKey || event.ctrlKey
}

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  clientX: number
  clientY: number
  base: Set<string>
  active: boolean
}

/**
 * File-manager style multi-select over a board of items (the project
 * board's window cards). Mirrors Windows Explorer / Finder:
 *
 * - click selects one; Ctrl/⌘-click toggles one; Shift-click selects the
 *   range from the last clicked item (Ctrl/⌘+Shift adds the range);
 * - a press on empty space drags a box that selects what it touches
 *   (Ctrl/⌘ held at the press adds to the selection); a plain click on
 *   empty space clears it;
 * - with focus on the board: Ctrl/⌘+A selects all, Esc clears, Delete /
 *   Backspace calls `onDelete`.
 *
 * Items are found in the DOM by `data-select-id` inside `containerRef`,
 * which must be the scrolling, `position: relative` element the marquee
 * is drawn in. `ids` is the board's visible order (for Shift ranges);
 * selected ids that leave it (filtered out, deleted) drop out of the
 * selection. `resetKey` (the project) starts a fresh, empty selection.
 */
export function useBoardSelection({
  ids,
  containerRef,
  resetKey,
  onDelete,
}: {
  ids: string[]
  containerRef: RefObject<HTMLElement | null>
  resetKey: string | undefined
  onDelete: (ids: string[]) => void
}) {
  const [state, setState] = useState<{ key: string | undefined; ids: Set<string> }>({
    key: resetKey,
    ids: new Set(),
  })
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null)
  const anchorRef = useRef<string | null>(null)
  const dragRef = useRef<DragState | null>(null)

  // Another project = a fresh selection, without an effect's extra render.
  const raw = state.key === resetKey ? state.ids : undefined
  const selected = useMemo(() => {
    if (!raw || raw.size === 0) return new Set<string>()
    return new Set(ids.filter((id) => raw.has(id)))
  }, [raw, ids])

  const setSelected = useCallback(
    (next: Set<string>) => setState({ key: resetKey, ids: next }),
    [resetKey],
  )

  const clear = useCallback(() => setSelected(new Set()), [setSelected])
  const selectAll = useCallback(() => setSelected(new Set(ids)), [ids, setSelected])

  /** A card's onClick. */
  const clickItem = (id: string, event: ReactMouseEvent) => {
    const anchor = anchorRef.current
    if (event.shiftKey && anchor && ids.includes(anchor)) {
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y)
      const range = ids.slice(a, b + 1)
      setSelected(isModifier(event) ? new Set([...selected, ...range]) : new Set(range))
      return
    }
    anchorRef.current = id
    if (isModifier(event)) {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelected(next)
    } else {
      setSelected(new Set([id]))
    }
  }

  /** A card's onContextMenu: right-clicking outside the selection selects only that card. */
  const contextItem = (id: string) => {
    if (selected.has(id)) return
    anchorRef.current = id
    setSelected(new Set([id]))
  }

  const toContent = (container: HTMLElement, clientX: number, clientY: number) => {
    const rect = container.getBoundingClientRect()
    return { x: clientX - rect.left + container.scrollLeft, y: clientY - rect.top + container.scrollTop }
  }

  const updateDrag = (container: HTMLElement, drag: DragState) => {
    const end = toContent(container, drag.clientX, drag.clientY)
    if (!drag.active) {
      if (Math.hypot(end.x - drag.startX, end.y - drag.startY) < DRAG_THRESHOLD_PX) return
      drag.active = true
    }
    const box = {
      left: Math.min(drag.startX, end.x),
      top: Math.min(drag.startY, end.y),
      width: Math.abs(end.x - drag.startX),
      height: Math.abs(end.y - drag.startY),
    }
    setMarquee(box)

    const containerRect = container.getBoundingClientRect()
    const next = new Set(drag.base)
    container.querySelectorAll<HTMLElement>('[data-select-id]').forEach((el) => {
      const r = el.getBoundingClientRect()
      const left = r.left - containerRect.left + container.scrollLeft
      const top = r.top - containerRect.top + container.scrollTop
      const hit =
        left < box.left + box.width && left + r.width > box.left && top < box.top + box.height && top + r.height > box.top
      if (hit) next.add(el.dataset.selectId!)
    })
    setSelected(next)
  }

  /** The board container's onPointerDown. */
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const container = containerRef.current
    if (!container || event.button !== 0) return
    if ((event.target as HTMLElement).closest(NO_MARQUEE)) return
    // No text selection while dragging; focus the board so the keyboard
    // shortcuts apply to it.
    event.preventDefault()
    container.focus({ preventScroll: true })
    container.setPointerCapture(event.pointerId)
    const start = toContent(container, event.clientX, event.clientY)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: start.x,
      startY: start.y,
      clientX: event.clientX,
      clientY: event.clientY,
      base: isModifier(event) ? new Set(selected) : new Set(),
      active: false,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const container = containerRef.current
    const drag = dragRef.current
    if (!container || !drag || drag.pointerId !== event.pointerId) return
    drag.clientX = event.clientX
    drag.clientY = event.clientY
    const rect = container.getBoundingClientRect()
    if (drag.active) {
      if (event.clientY < rect.top + AUTOSCROLL_EDGE_PX) container.scrollTop -= AUTOSCROLL_STEP_PX
      else if (event.clientY > rect.bottom - AUTOSCROLL_EDGE_PX) container.scrollTop += AUTOSCROLL_STEP_PX
    }
    updateDrag(container, drag)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    containerRef.current?.releasePointerCapture(event.pointerId)
    if (drag.active) setMarquee(null)
    else if (event.type === 'pointerup' && !isModifier(event)) clear()
  }

  // Keyboard shortcuts, while focus is on the board. Capture phase, so a
  // Delete with windows selected is claimed (preventDefault) before the
  // workspace layout's own bubble-phase listener would delete the project.
  const selectedRef = useRef(selected)
  const onDeleteRef = useRef(onDelete)
  useEffect(() => {
    selectedRef.current = selected
    onDeleteRef.current = onDelete
  })
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current
      if (!container || !container.contains(document.activeElement)) return
      if (isEditable(event.target)) return
      if ((event.target as HTMLElement | null)?.closest('[role="dialog"], [role="menu"]')) return

      const current = selectedRef.current
      if (isModifier(event) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAll()
      } else if (event.key === 'Escape' && current.size > 0) {
        event.preventDefault()
        clear()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && current.size > 0) {
        event.preventDefault()
        onDeleteRef.current([...current])
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [containerRef, selectAll, clear])

  return {
    selected,
    marquee,
    clickItem,
    contextItem,
    clear,
    containerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  }
}
