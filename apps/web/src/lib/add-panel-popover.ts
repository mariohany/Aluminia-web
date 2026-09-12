import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { PanelSide } from '@/lib/window-geometry'

export interface AddPanelRequest {
  side: PanelSide
  /** The "+" marker's position inside the drawing's own box — the same
   * coordinate space the dimension inputs are placed in. */
  at: { left: number; top: number }
  /** Pre-filled size: the cross-dimension is the selection's union, the
   * other comes from the panel being cloned. See `prefillForSide()`. */
  widthMm: number
  heightMm: number
}

/** Pushes a "+"-anchored popover clear of the marker it belongs to, on
 * whichever side it opened. Shared by every popover in the flow (the
 * type-step chooser, both size cards) — not co-located with any one of
 * them, so pulling in the shared position logic below doesn't also pull
 * in a specific component's own JSX. */
export const OFFSET_BY_SIDE: Record<PanelSide, string> = {
  right: 'translate(12px, -50%)',
  left: 'translate(calc(-100% - 12px), -50%)',
  top: 'translate(-50%, calc(-100% - 12px))',
  bottom: 'translate(-50%, 12px)',
}

/**
 * Positions any "+"-anchored popover clear of the drawing box's own
 * edges. A plain hook in its own non-component file, not co-located
 * with `AddPanelCard` (the only one there used to be) — oxlint's
 * `react-refresh/only-export-components` rule is right that a shared
 * hook exported alongside a component breaks Fast Refresh for that
 * file, and this hook now has three real consumers
 * (`add-panel-card.tsx`, `add-panel-type-step.tsx`,
 * `add-transom-card.tsx`), not just the one it was extracted from.
 *
 * `remeasureKey` lets a caller trigger a re-measure when ITS OWN
 * content changes height for a reason this hook can't see (an error
 * line appearing, for instance) — pass whatever value should force a
 * fresh measurement, or `undefined` for a popover whose height never
 * changes after mount.
 */
export function useAddPanelCardPosition(anchor: { side: PanelSide; at: { left: number; top: number } } | null, remeasureKey?: unknown) {
  const cardRef = useRef<HTMLDivElement>(null)
  // Nudged back inside the drawing box when the preferred side would
  // hang off an edge — attaching above a panel near the top otherwise
  // opens the card half outside the container and clips its heading.
  const [nudge, setNudge] = useState({ x: 0, y: 0 })

  // Measured after the card is laid out at its preferred position, so
  // the correction accounts for its real height (which depends on
  // whether an error line, or any other conditional content, is
  // showing — see `remeasureKey`).
  useLayoutEffect(() => {
    const card = cardRef.current
    const box = card?.offsetParent as HTMLElement | null | undefined
    if (!card || !box) return
    const margin = 8
    const cardBox = card.getBoundingClientRect()
    const parentBox = box.getBoundingClientRect()
    const overTop = parentBox.top + margin - cardBox.top
    const overBottom = cardBox.bottom - (parentBox.bottom - margin)
    const overLeft = parentBox.left + margin - cardBox.left
    const overRight = cardBox.right - (parentBox.right - margin)
    const next = {
      x: overLeft > 0 ? overLeft : overRight > 0 ? -overRight : 0,
      y: overTop > 0 ? overTop : overBottom > 0 ? -overBottom : 0,
    }
    setNudge((prev) => (prev.x === next.x && prev.y === next.y ? prev : next))
    // Re-measure only when something that moves or resizes the card
    // changes: which marker opened it, where that marker is, and
    // whatever content-driven height change the caller flags via
    // `remeasureKey`. Deliberately not every render — this sets state,
    // and an unguarded version would be one missed equality check away
    // from an update loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.side, anchor?.at.left, anchor?.at.top, remeasureKey])

  const style: CSSProperties | undefined = anchor
    ? {
        left: anchor.at.left,
        top: anchor.at.top,
        transform: `translate(${nudge.x}px, ${nudge.y}px) ${OFFSET_BY_SIDE[anchor.side]}`,
      }
    : undefined

  return { cardRef, style }
}
