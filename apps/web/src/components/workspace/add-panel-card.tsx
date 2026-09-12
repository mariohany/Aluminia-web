import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAddPanelCardPosition, type AddPanelRequest } from '@/lib/add-panel-popover'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/workspace/field-label'
import { Input } from '@/components/ui/input'

export type { AddPanelRequest }

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
  const { cardRef, style } = useAddPanelCardPosition(request, error)

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

  if (!request) return null

  const valid = Number.isFinite(widthMm) && widthMm >= 1 && Number.isFinite(heightMm) && heightMm >= 1

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
