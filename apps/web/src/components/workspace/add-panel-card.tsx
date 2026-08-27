import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { PanelSide } from '@/lib/window-geometry'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/workspace/field-label'
import { Input } from '@/components/ui/input'

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

/** Pushes the card clear of the marker it belongs to, on whichever side
 * it opened. */
const OFFSET_BY_SIDE: Record<PanelSide, string> = {
  right: 'translate(12px, -50%)',
  left: 'translate(calc(-100% - 12px), -50%)',
  top: 'translate(-50%, calc(-100% - 12px))',
  bottom: 'translate(-50%, 12px)',
}

/**
 * The size prompt behind a "+" marker.
 *
 * Deliberately a plain absolutely-positioned card, NOT a Radix
 * `Popover` and not a `Dialog`. Both were tried and both lost fights
 * with the window dialog they open inside: a portalled layer is a DOM
 * sibling of the dialog, so every click in it reads as "outside" (which
 * dismissed the whole dialog mid-edit), and the dialog's modal focus
 * trap yanks focus back the instant the layer mounts, which the layer
 * then reads as `onFocusOutside` and closes itself. This renders into
 * the drawing's own overlay layer instead — the same `relative` box the
 * dimension inputs already live in — so there is no portal, no second
 * focus scope, and no dismissal semantics to fight.
 *
 * Both fields are freely editable, including the pre-filled one: the
 * user explicitly asked for that, and a size that no longer matches the
 * edge just produces a stepped outline, which is a real fabricated
 * shape (flagged amber elsewhere, never blocked). What IS refused is a
 * size that would overlap an existing panel — the caller reports that
 * back through `error`.
 */
export function AddPanelCard({
  request,
  onCancel,
  onConfirm,
  error,
}: {
  request: AddPanelRequest | null
  onCancel: () => void
  onConfirm: (widthMm: number, heightMm: number) => void
  /** Already-translated. */
  error?: string
}) {
  const { t } = useTranslation('workspace')
  const [widthMm, setWidthMm] = useState(0)
  const [heightMm, setHeightMm] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  // Nudged back inside the drawing box when the preferred side would
  // hang off an edge — attaching above a panel near the top otherwise
  // opens the card half outside the container and clips its heading.
  const [nudge, setNudge] = useState({ x: 0, y: 0 })

  // Re-seed whenever a different "+" is pressed. Keyed on the side and
  // the pre-filled numbers rather than object identity — `request` is a
  // fresh object every render, so keying on it would wipe whatever the
  // user has typed the moment anything else in the dialog re-renders.
  useEffect(() => {
    if (!request) return
    setWidthMm(request.widthMm)
    setHeightMm(request.heightMm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.side, request?.widthMm, request?.heightMm])

  // Measured after the card is laid out at its preferred position, so
  // the correction accounts for its real height (which depends on
  // whether an error line is showing).
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
    // whether the error line is taking up a row. Deliberately not every
    // render — this sets state, and an unguarded version would be one
    // missed equality check away from an update loop.
  }, [request?.side, request?.at.left, request?.at.top, error])

  if (!request) return null

  const valid = Number.isFinite(widthMm) && widthMm >= 1 && Number.isFinite(heightMm) && heightMm >= 1
  const style: CSSProperties = {
    left: request.at.left,
    top: request.at.top,
    transform: `translate(${nudge.x}px, ${nudge.y}px) ${OFFSET_BY_SIDE[request.side]}`,
  }

  return (
    // dir="ltr" is inherited from the drawing, which never mirrors; the
    // card is ordinary UI text, so it opts back in to the app's own
    // direction.
    <div
      ref={cardRef}
      dir={document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'}
      role="dialog"
      aria-label={t('windowDialog.design.addPanel.title')}
      className="absolute z-20 w-60 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <p className="text-sm font-medium">{t('windowDialog.design.addPanel.title')}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t(`windowDialog.design.addPanel.side.${request.side}`)}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <FieldLabel htmlFor="add-panel-width">{t('fields.widthMm')}</FieldLabel>
          <Input
            id="add-panel-width"
            type="number"
            min={1}
            dir="ltr"
            autoFocus
            className="mt-1 tabular-nums"
            value={Number.isFinite(widthMm) ? widthMm : ''}
            onChange={(e) => setWidthMm(Number(e.target.value))}
          />
        </div>
        <div>
          <FieldLabel htmlFor="add-panel-height">{t('fields.heightMm')}</FieldLabel>
          <Input
            id="add-panel-height"
            type="number"
            min={1}
            dir="ltr"
            className="mt-1 tabular-nums"
            value={Number.isFinite(heightMm) ? heightMm : ''}
            onChange={(e) => setHeightMm(Number(e.target.value))}
          />
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{t('windowDialog.design.addPanel.clonesHint')}</p>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button type="button" size="sm" disabled={!valid} onClick={() => onConfirm(widthMm, heightMm)}>
          {t('windowDialog.design.addPanel.add')}
        </Button>
      </div>
    </div>
  )
}
