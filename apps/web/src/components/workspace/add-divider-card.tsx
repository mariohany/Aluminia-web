import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import { useAddPanelCardPosition, type AddPanelRequest } from '@/lib/add-panel-popover'
import type { MergedSystemProfileSummary } from '@/lib/lookup-merge'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/workspace/field-label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// A small, typical section size, not the panel's own cross-dimension —
// cloning the panel's full size (what AddPanelCard's own prefill does
// for a genuinely new coupled frame) reads fine there, but for a new
// section it produced an unusable default in the equivalent transom
// flow this replaces (docs/transom_planing.md's own finding, still
// true here: a divider above a 2100mm door started pre-filled at
// 2100mm tall).
const DEFAULT_SECTION_SIZE_MM = 300

// Radix rejects an empty-string item value — same sentinel
// window-part-panel.tsx's own sash/glass selects use.
const NONE = '__none'

/**
 * The card behind "+" → Mullion/Transom (docs/sections_planing.md §5):
 * the new section's size (width for left/right, height for top/bottom)
 * plus the panel's own divider profile — asked for here too (Mario,
 * 2026-09-15: "can we add also a drop down list for the transom/mullion
 * profile") rather than only as a separate follow-up field on the panel
 * once it's already gridded. One profile per panel (decision 4): picking
 * it here sets the SAME field the side panel's own picker edits, so
 * re-adding a second divider to an already-gridded panel starts this
 * field pre-filled with whatever was already chosen, not blank.
 * No glass picker here — the new section always starts FIXED, cloning
 * an existing section's glass (`window-editor-page.tsx`'s own
 * `makeSection`). A plain filtered `<Select>`, not the tree picker the
 * side panel's own divider field uses — the caller already scopes
 * `dividerOptions` to the frame's own catalogue (bug-040's hard-filter
 * rule), so once scoped to one catalogue a flat list is enough, same
 * posture as the sash profile select. Same anchored-popover shell as
 * `AddPanelCard`/`AddPanelTypeStep`.
 */
export function AddDividerCard({
  request,
  title,
  onCancel,
  onConfirm,
  error,
  initialDividerProfile,
  dividerOptions,
}: {
  request: AddPanelRequest | null
  /** Already-translated — "Add a mullion" or "Add a transom", decided
   * by the caller from which side opened this. */
  title: string
  onCancel: () => void
  onConfirm: (sizeMm: number, dividerProfile: ScopedRef) => void
  /** Already-translated. */
  error?: string
  /** The panel's own `dividerProfile` at the moment this popup opens —
   * `''` for a 1×1 panel gaining its first divider, or whatever was
   * already picked if a divider profile is already set. */
  initialDividerProfile: string
  /** Already scoped to the target panel's own frame catalogue by the
   * caller (`window-editor-page.tsx`) — this card has no opinion on
   * which catalogue, only on which of the given options is selected. */
  dividerOptions: MergedSystemProfileSummary[]
}) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')
  const { cardRef, style } = useAddPanelCardPosition(request, error, onCancel)
  const [sizeMm, setSizeMm] = useState(DEFAULT_SECTION_SIZE_MM)
  const [dividerProfile, setDividerProfile] = useState(initialDividerProfile)

  // Attach top/bottom → the new row's height is typed; left/right → the
  // new column's width. The OTHER dimension (the panel's own, unaffected
  // dimension) isn't shown here at all — unlike AddPanelCard/the old
  // transom card, there is no second field to disable.
  const editableDim = request?.side === 'top' || request?.side === 'bottom' ? 'height' : 'width'
  const label = editableDim === 'width' ? t('windowDialog.design.addPanel.sectionWidth') : t('windowDialog.design.addPanel.sectionHeight')

  useEffect(() => {
    if (!request) return
    setSizeMm(DEFAULT_SECTION_SIZE_MM)
    setDividerProfile(initialDividerProfile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.side, request?.widthMm, request?.heightMm])

  if (!request) return null

  const valid = Number.isFinite(sizeMm) && sizeMm >= 1 && !!dividerProfile

  return (
    <div
      ref={cardRef}
      dir={document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'}
      role="dialog"
      aria-label={title}
      className="absolute z-20 w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t(`windowDialog.design.addPanel.side.${request.side}`)}</p>

      <div className="mt-3">
        <FieldLabel htmlFor="add-divider-size">{label}</FieldLabel>
        <Input
          id="add-divider-size"
          type="number"
          min={1}
          dir="ltr"
          autoFocus
          className="mt-1 tabular-nums"
          value={Number.isFinite(sizeMm) ? sizeMm : ''}
          onChange={(e) => setSizeMm(Number(e.target.value))}
        />
      </div>

      <div className="mt-3">
        <FieldLabel htmlFor="add-divider-profile" required>
          {t('fields.dividerProfileAddLabel')}
        </FieldLabel>
        <Select
          value={dividerProfile || NONE}
          disabled={dividerOptions.length === 0}
          onValueChange={(value) => {
            if (!value) return
            setDividerProfile(value)
          }}
        >
          <SelectTrigger id="add-divider-profile" className="mt-1 w-full">
            <SelectValue placeholder={dividerOptions.length === 0 ? t('fields.dividerProfileNeedsFrame') : t('fields.dividerProfilePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} disabled>
              {t('fields.dividerProfilePlaceholder')}
            </SelectItem>
            {dividerOptions.map((opt) => (
              <SelectItem key={opt.id} value={formatScopedRef(opt.scope, opt.id)}>
                {opt.profileNo} — {tLookups('fields.maxGlassThickness')}: {opt.maxGlassThickness}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button type="button" size="sm" disabled={!valid} onClick={() => onConfirm(sizeMm, dividerProfile as ScopedRef)}>
          {t('windowDialog.design.addPanel.add')}
        </Button>
      </div>
    </div>
  )
}
