import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassKind } from '@repo/types/windows'
import { ProfileType } from '@repo/types/lookups'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import { useMergedGlassCombinationsQuery, useMergedGlassQuery, useMergedSystemProfilesQuery } from '@/lib/lookup-merge'
import { BEAD_ALLOWANCE_MM } from '@/lib/window-render'
import { useAddPanelCardPosition, type AddPanelRequest } from '@/lib/add-panel-popover'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/workspace/field-label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'

export interface AddTransomInput {
  sizeMm: number
  transomProfile: ScopedRef
  glassKind: GlassKind
  glass: ScopedRef
}

// What the editable dimension starts at — a small, typical transom
// depth, not the neighbour's own cross-dimension. Cloning the
// neighbour (what `prefillForSide` returns, and what the WINDOW add
// card genuinely wants) reads fine for a window attaching to a
// same-sized window, but for a transom it produced an unusable
// default — a transom above a 2100mm door started pre-filled at
// 2100mm tall. Found live in the browser, not hypothetical.
const DEFAULT_TRANSOM_SIZE_MM = 300

/**
 * The transom counterpart to `AddPanelCard` — same anchored-popover
 * shell (see that file's own comment on why it's neither a `Popover`
 * nor a `Dialog`), a genuinely different form inside: ONE editable size
 * field, not two (decision 2 — top/bottom borrows the selection's
 * width and asks for a height, left/right the mirror), a
 * `ProfileTreePicker` scoped to `ProfileType.TRANSOM` instead of a
 * clone of the neighbour's own frame/sash, and a glass `<Select>`
 * gated by the CHOSEN transom profile's own `maxGlassThickness` — there
 * is no sash here to derive that ceiling from, so it's computed locally
 * rather than reusing `window-editor-page.tsx`'s own `activeInfo`, which
 * describes the ACTIVE panel, not the one still being created.
 */
export function AddTransomCard({
  request,
  onCancel,
  onConfirm,
  error,
  preferredCatalogRef,
  preferredBrandRef,
}: {
  request: AddPanelRequest | null
  onCancel: () => void
  onConfirm: (input: AddTransomInput) => void
  /** Already-translated. */
  error?: string
  preferredCatalogRef?: string | null
  preferredBrandRef?: string | null
}) {
  const { t } = useTranslation('workspace')
  const { cardRef, style } = useAddPanelCardPosition(request, error)
  const profilesQuery = useMergedSystemProfilesQuery()
  const glassQuery = useMergedGlassQuery()
  const combinationsQuery = useMergedGlassCombinationsQuery()

  const [sizeMm, setSizeMm] = useState(0)
  const [transomProfile, setTransomProfile] = useState<ScopedRef | ''>('')
  const [glassValue, setGlassValue] = useState('')

  // Attach top/bottom → width comes from the selection, height is
  // typed; left/right → the mirror (§4/decision 2). The OTHER
  // dimension is read straight off `request` and never edited here.
  const editableDim = request?.side === 'top' || request?.side === 'bottom' ? 'height' : 'width'

  // Re-seed whenever a different "+" is pressed — same keying rationale
  // as AddPanelCard's own effect (object identity would wipe a
  // half-typed size on an unrelated re-render). Unlike AddPanelCard,
  // the editable dimension does NOT clone the neighbour's own size —
  // see `DEFAULT_TRANSOM_SIZE_MM`'s own comment.
  useEffect(() => {
    if (!request) return
    setSizeMm(DEFAULT_TRANSOM_SIZE_MM)
    setTransomProfile('')
    setGlassValue('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.side, request?.widthMm, request?.heightMm])

  if (!request) return null

  const selectedProfile = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === transomProfile)
  const maxGlassAllowed =
    selectedProfile?.maxGlassThickness != null ? selectedProfile.maxGlassThickness - BEAD_ALLOWANCE_MM : null

  const glassOptions = [
    ...(glassQuery.data ?? [])
      .filter((g) => maxGlassAllowed != null && g.thickness <= maxGlassAllowed)
      .map((g) => ({
        value: `${GlassKind.SINGLE}|${formatScopedRef(g.scope, g.id)}`,
        label: `${g.name} — ${g.thickness} mm`,
      })),
    ...(combinationsQuery.data ?? [])
      .filter((c) => maxGlassAllowed != null && c.totalThickness <= maxGlassAllowed)
      .map((c) => ({
        value: `${GlassKind.COMBINATION}|${formatScopedRef(c.scope, c.id)}`,
        label: `${c.name} — ${c.totalThickness} mm`,
      })),
  ]

  const valid = Number.isFinite(sizeMm) && sizeMm >= 1 && !!transomProfile && !!glassValue

  const confirm = () => {
    if (!valid || !transomProfile) return
    const [kind, ref] = glassValue.split('|') as [GlassKind, ScopedRef]
    onConfirm({ sizeMm, transomProfile, glassKind: kind, glass: ref })
  }

  return (
    <div
      ref={cardRef}
      dir={document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'}
      role="dialog"
      aria-label={t('windowDialog.design.addPanel.transomTitle')}
      className="absolute z-20 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <p className="text-sm font-medium">{t('windowDialog.design.addPanel.transomTitle')}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t(`windowDialog.design.addPanel.side.${request.side}`)}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <FieldLabel htmlFor="add-transom-width">{t('fields.widthMm')}</FieldLabel>
          <Input
            id="add-transom-width"
            type="number"
            min={1}
            dir="ltr"
            autoFocus={editableDim === 'width'}
            disabled={editableDim !== 'width'}
            className="mt-1 tabular-nums"
            value={editableDim === 'width' ? (Number.isFinite(sizeMm) ? sizeMm : '') : request.widthMm}
            onChange={(e) => editableDim === 'width' && setSizeMm(Number(e.target.value))}
          />
        </div>
        <div>
          <FieldLabel htmlFor="add-transom-height">{t('fields.heightMm')}</FieldLabel>
          <Input
            id="add-transom-height"
            type="number"
            min={1}
            dir="ltr"
            autoFocus={editableDim === 'height'}
            disabled={editableDim !== 'height'}
            className="mt-1 tabular-nums"
            value={editableDim === 'height' ? (Number.isFinite(sizeMm) ? sizeMm : '') : request.heightMm}
            onChange={(e) => editableDim === 'height' && setSizeMm(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="mt-3">
        <FieldLabel htmlFor="add-transom-profile" required>
          {t('fields.transomProfile')}
        </FieldLabel>
        <div className="mt-1 h-40 min-h-0 rounded-md border border-border">
          <ProfileTreePicker
            profileType={ProfileType.TRANSOM}
            value={transomProfile || null}
            onChange={(ref) => {
              setTransomProfile(ref)
              setGlassValue('')
            }}
            preferredCatalogRef={preferredCatalogRef}
            preferredBrandRef={preferredBrandRef}
          />
        </div>
      </div>

      <div className="mt-3">
        <FieldLabel htmlFor="add-transom-glass" required>
          {t('fields.glass')}
        </FieldLabel>
        <Select
          value={glassValue}
          disabled={glassOptions.length === 0}
          onValueChange={(value) => value && setGlassValue(value)}
        >
          <SelectTrigger id="add-transom-glass" className="mt-1 w-full">
            <SelectValue
              placeholder={glassOptions.length === 0 ? t('fields.glassNeedsTransomProfile') : t('fields.glassPlaceholder')}
            />
          </SelectTrigger>
          <SelectContent>
            {glassOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
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
        <Button type="button" size="sm" disabled={!valid} onClick={confirm}>
          {t('windowDialog.design.addPanel.add')}
        </Button>
      </div>
    </div>
  )
}
