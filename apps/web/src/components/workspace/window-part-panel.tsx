import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { GlassKind, HeadShape, HingedOpeningType } from '@repo/types/windows'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import type { WindowLayout, WindowPartKind } from '@/lib/window-geometry'
import { dedupeIssues, type TranslatedIssue } from '@/lib/window-weight'
import type { MergedSystemProfileSummary } from '@/lib/lookup-merge'
import { minGothicRiseMm, normalizeHeadRise, type HeadOutline } from '@/lib/arch-geometry'
import { cn } from '@/lib/utils'
import { FieldLabel } from '@/components/workspace/field-label'
import { OpeningTypeIcon } from '@/components/icons/opening-type-icon'
import { archOutlinePath } from '@/components/workspace/window-shapes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Radix rejects an empty-string item value — same sentinel window-dialog.tsx uses.
const NONE = '__none'

// Grid order — one row of the four "primary" hinge/pivot ways a single
// leaf opens, then their mirrored/tilt-turn pairs, then the two-leaf and
// fixed-mullion families last (the less common picks).
const OPENING_TYPE_OPTIONS: HingedOpeningType[] = [
  HingedOpeningType.FIXED_CLOSED,
  HingedOpeningType.TOP_HUNG,
  HingedOpeningType.SIDE_HUNG_LEFT,
  HingedOpeningType.SIDE_HUNG_RIGHT,
  HingedOpeningType.TILT_TURN_LEFT,
  HingedOpeningType.TILT_TURN_RIGHT,
  HingedOpeningType.PIVOT_BOTTOM,
  HingedOpeningType.PIVOT_SIDE,
  HingedOpeningType.SINGLE_DOOR_HINGE_LEFT,
  HingedOpeningType.SINGLE_DOOR_HINGE_RIGHT,
  HingedOpeningType.DOUBLE_DOOR_FRENCH_A,
  HingedOpeningType.DOUBLE_DOOR_FRENCH_B,
  HingedOpeningType.DOUBLE_DOOR_HANDLES_A,
  HingedOpeningType.DOUBLE_DOOR_HANDLES_B,
  HingedOpeningType.FIXED_VERTICAL_MULLION,
  HingedOpeningType.FIXED_HORIZONTAL_MULLION,
]

const HEAD_SHAPE_OPTIONS: HeadShape[] = [HeadShape.FLAT, HeadShape.ROUND, HeadShape.SEGMENTAL, HeadShape.GOTHIC]

// Fixed 40×46 demo outlines for the four shape-button icons — not the
// panel's own rect. `round`'s rise is the real formula (width / 2);
// `segmental`/`gothic` are just representative enough to read as
// "shallow" and "pointed" at icon size, same way OpeningTypeIcon's
// glyphs are illustrative rather than derived from a real sash.
const HEAD_SHAPE_ICON_OUTLINES: Record<HeadShape, HeadOutline> = {
  [HeadShape.FLAT]: { rect: { x: 2, y: 2, width: 36, height: 42 }, shape: HeadShape.FLAT, riseMm: 0 },
  [HeadShape.ROUND]: { rect: { x: 2, y: 2, width: 36, height: 42 }, shape: HeadShape.ROUND, riseMm: 18 },
  [HeadShape.SEGMENTAL]: { rect: { x: 2, y: 2, width: 36, height: 42 }, shape: HeadShape.SEGMENTAL, riseMm: 10 },
  [HeadShape.GOTHIC]: { rect: { x: 2, y: 2, width: 36, height: 42 }, shape: HeadShape.GOTHIC, riseMm: 31 },
}

export interface WindowPartPanelColorOption {
  value: string
  label: string
  hex: string
}

export interface WindowPartPanelGlassOption {
  value: string
  label: string
}

export interface WindowPartPanelProps {
  /** The current drawing layout — Sash/Glass read their own part's
   * computed size from here directly, independent of what's selected,
   * since every section renders at once. */
  layout: WindowLayout
  /** Drives which section scrolls into view + gets the focus ring
   * (frame's own focus ring lives on window-dialog.tsx's tree column
   * instead — the tree isn't part of this panel any more). */
  selectedPartId: string | null
  /** Full map from `collectWindowIssues()`, keyed by part id — each
   * section filters out its own kind's issues. */
  issuesByPart: Map<string, TranslatedIssue[]>

  /** Which panel of the assembly every per-panel field below edits,
   * and how many there are. A one-panel window hides the Panel section
   * entirely — "Panel 1 of 1" is just the window. */
  panelIndex: number
  panelCount: number
  /** `undefined` when this panel can't be removed — the caller passes a
   * translated reason instead, via `deleteDisabledReason`. */
  onDeletePanel?: () => void
  deleteDisabledReason?: string

  name: string
  onNameChange: (value: string) => void
  /** Already-translated "required" messages — undefined/blank means no
   * error is shown. window-dialog.tsx only ever passes these once
   * `showValidation` is true (edit mode, or after a first submit
   * attempt in create mode) — see its own comment for why. */
  nameError?: string
  quantity: number
  onQuantityChange: (value: number) => void
  quantityError?: string

  /** The SELECTED PANEL's size, not the assembly's — the assembly's is
   * derived from the panels' bounding box and shown read-only on the
   * drawing. `quantity` below really is the whole assembly's: you order
   * three of the unit, not three of panel 2. */
  widthMm: number
  heightMm: number
  onWidthChange: (mm: number) => void
  onHeightChange: (mm: number) => void
  widthError?: string
  heightError?: string

  // Head — arch_windows_planing.md §7. `headShapeAllowed` is
  // `canHaveArchedHead()` from window-geometry.ts, computed once in
  // window-dialog.tsx from the same fields `showOpeningTypes`/`showDoor`
  // already derive — false disables the shape buttons rather than
  // letting the user pick a shape `buildWindowLayout` would silently
  // draw flat (sliding, double-door, fixed-mullion, a hinged door).
  headShape: HeadShape
  headRiseMm: number | null
  onHeadShapeChange: (shape: HeadShape) => void
  onHeadRiseChange: (mm: number) => void
  headShapeAllowed: boolean

  // Bars — arch_windows_planing.md §6.1/§6.2. A persistent toggle (the
  // user's own chosen interaction, over a one-shot tool): it stays on
  // across multiple bars, and window-dialog.tsx owns turning it back
  // off (re-click, `Escape` with nothing pending, switching panels, or
  // flattening the head).
  barDrawMode: boolean
  onBarDrawModeChange: (on: boolean) => void
  barCount: number
  /** Non-null while a bar is selected — arch_windows_planing.md §6.3.
   * `lengthMm`/`radiusMm`/`minRadiusMm` are already resolved/derived,
   * `null` only for a dangling anchor chain mid-edit (or, for
   * `radiusMm` specifically, a straight bar — `R = ∞`), same as
   * everywhere else a resolved value can legitimately be missing. */
  selectedBar: { id: string; lengthMm: number | null; radiusMm: number | null; minRadiusMm: number | null } | null
  /** Starts the delete confirm (button here, or `Delete`/`Backspace`
   * on the drawing) — the actual removal, and the danger-colour
   * highlight of what else goes with it, are owned by `WindowDialog`. */
  onRequestDeleteBar: () => void
  /** `null` clears the field, flattening the bar back to a line
   * (§6.5) — the radius input's own mirror of dragging the bow handle
   * to zero, not a separate control. */
  onBarRadiusChange: (radiusMm: number | null) => void

  hasFlyScreen: boolean
  flyScreenAllowed: boolean
  onFlyScreenChange: (value: boolean) => void
  showDoor: boolean
  isDoor: boolean
  onDoorChange: (value: boolean) => void

  interiorColor: string | null
  exteriorColor: string | null
  onInteriorColorChange: (value: string | null) => void
  onExteriorColorChange: (value: string | null) => void
  colorOptions: WindowPartPanelColorOption[]

  // Type — the opening-type icon grid, hinged windows only (sliding
  // gets its own icon set later, not this one). window-dialog.tsx
  // already clears the value when the frame stops being hinged, so this
  // panel only has to decide whether to show the grid at all.
  showOpeningTypes: boolean
  openingType: HingedOpeningType | null
  onOpeningTypeChange: (value: HingedOpeningType | null) => void

  // Sash
  sashProfile: string
  sashOptions: MergedSystemProfileSummary[]
  onSashChange: (ref: ScopedRef) => void
  sashWeightKg: number | null
  maxSashWeight: number | null

  // Glass
  glassValue: string
  glassOptions: WindowPartPanelGlassOption[]
  onGlassChange: (kind: GlassKind, ref: ScopedRef) => void
  maxGlassAllowed: number | null
  sashMaxGlassThickness: number | null

  // Belongs to no drawn part — same posture as name/size/quantity above.
  location: string | null
  onLocationChange: (value: string | null) => void
  notes: string | null
  onNotesChange: (value: string | null) => void
}

/**
 * The dialog's fixed-width options column. Name, size/quantity, the
 * fly-screen/door checkboxes, both colours, and location/notes sit at
 * the top as plain fields (they belong to the whole window, not one
 * drawn part); Sash and Glass are their own scroll-targeted sections
 * below. Clicking a part on the drawing scrolls its section into view
 * and gives it a focus ring.
 */
export function WindowPartPanel(props: WindowPartPanelProps) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')

  const sashRef = useRef<HTMLDivElement>(null)
  const glassRef = useRef<HTMLDivElement>(null)
  const flyScreenRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const sectionRefs: Partial<Record<WindowPartKind, React.RefObject<HTMLDivElement | null>>> = {
    sash: sashRef,
    glass: glassRef,
    flyScreen: flyScreenRef,
  }

  const selectedPart = props.layout.parts.find((p) => p.id === props.selectedPartId) ?? null

  useEffect(() => {
    if (!selectedPart) return
    sectionRefs[selectedPart.kind]?.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // Only the identity of the selection should re-trigger a scroll —
    // not every render, and not a re-render of the layout itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedPartId])

  useEffect(() => {
    if (!props.selectedBar) return
    barRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedBar?.id])

  const sashPart = props.layout.parts.find((p) => p.kind === 'sash')
  const glassPart = props.layout.parts.find((p) => p.kind === 'glass')

  const sashIssues = dedupeIssues(
    props.layout.parts.filter((p) => p.kind === 'sash').flatMap((p) => props.issuesByPart.get(p.id) ?? []),
  )
  const glassIssues = dedupeIssues(
    props.layout.parts.filter((p) => p.kind === 'glass').flatMap((p) => props.issuesByPart.get(p.id) ?? []),
  )
  const flyScreenPart = props.layout.parts.find((p) => p.kind === 'flyScreen')
  const flyScreenIssues = flyScreenPart ? (props.issuesByPart.get(flyScreenPart.id) ?? []) : []

  return (
    <div className="flex flex-col gap-4 text-sm">
      <PanelHeader
        panelIndex={props.panelIndex}
        panelCount={props.panelCount}
        onDeletePanel={props.onDeletePanel}
        deleteDisabledReason={props.deleteDisabledReason}
      />

      <div>
        <FieldLabel htmlFor="panel-name" required>
          {t('fields.windowName')}
        </FieldLabel>
        <Input
          id="panel-name"
          className="mt-1.5"
          aria-invalid={!!props.nameError}
          value={props.name}
          onChange={(e) => props.onNameChange(e.target.value)}
        />
        {props.nameError && <p className="mt-1 text-xs text-destructive">{props.nameError}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberField
          id="panel-width"
          label={t('fields.widthMm')}
          value={props.widthMm}
          onChange={props.onWidthChange}
          error={props.widthError}
        />
        <NumberField
          id="panel-height"
          label={t('fields.heightMm')}
          value={props.heightMm}
          onChange={props.onHeightChange}
          error={props.heightError}
        />
        <NumberField
          id="panel-quantity"
          label={t('fields.quantity')}
          value={props.quantity}
          onChange={props.onQuantityChange}
          error={props.quantityError}
        />
      </div>

      <div>
        <FieldLabel htmlFor="panel-head-shape">{t('fields.headShapeSection')}</FieldLabel>
        <div
          id="panel-head-shape"
          role="group"
          aria-label={t('fields.headShapeSection')}
          className="mt-1.5 grid grid-cols-4 gap-1"
        >
          {HEAD_SHAPE_OPTIONS.map((shape) => {
            const selected = props.headShape === shape
            // `round`'s rise is always exactly `widthMm / 2` — a true
            // semicircle, never adjustable — so unlike segmental/gothic
            // (whose rise the user can simply pick something smaller
            // for), there's no valid rise left to offer once the panel
            // is too wide for its own height: a real semicircle that
            // wide needs more vertical room than the panel has. Disable
            // the button itself rather than silently drawing a flatter
            // curve than "round" promised.
            const roundDoesNotFit = shape === HeadShape.ROUND && props.widthMm / 2 >= props.heightMm
            const disabled = !props.headShapeAllowed || roundDoesNotFit
            const disabledHint = !props.headShapeAllowed
              ? t('fields.headShapeDisabledHint')
              : roundDoesNotFit
                ? t('fields.headShapeRoundTooWideHint')
                : undefined
            return (
              <button
                key={shape}
                type="button"
                disabled={disabled}
                title={disabledHint ?? t(`fields.headShapeLabels.${shape}`)}
                aria-label={t(`fields.headShapeLabels.${shape}`)}
                aria-pressed={selected}
                // Re-clicking the already-selected shape is a no-op —
                // window-dialog.tsx's handler always writes a fresh
                // shape-appropriate default rise, which would otherwise
                // clobber a value the user is still editing every time
                // they happened to click the button they're already on.
                onClick={() => {
                  if (!selected) props.onHeadShapeChange(shape)
                }}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground',
                )}
              >
                <svg viewBox="0 0 40 46" className="h-8 w-7 text-foreground" aria-hidden="true">
                  <path d={archOutlinePath(HEAD_SHAPE_ICON_OUTLINES[shape])} fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span className="text-[10px] leading-none text-muted-foreground">
                  {t(`fields.headShapeLabels.${shape}`)}
                </span>
              </button>
            )
          })}
        </div>
        {props.headShape !== HeadShape.FLAT && (
          <div className="mt-2 max-w-32">
            <NumberField
              id="panel-head-rise"
              label={t('fields.headRiseMm')}
              value={
                props.headShape === HeadShape.ROUND
                  ? normalizeHeadRise(HeadShape.ROUND, props.widthMm, 0, props.heightMm)
                  : (props.headRiseMm ?? 0)
              }
              onChange={props.onHeadRiseChange}
              disabled={props.headShape === HeadShape.ROUND}
              // Below this, a gothic head's two arcs stop meeting at a
              // point and cross each other instead — a shape with no
              // real bend a fabricator could set out to. See
              // arch-geometry.ts's minGothicRiseMm.
              min={props.headShape === HeadShape.GOTHIC ? Math.ceil(minGothicRiseMm(props.widthMm)) + 1 : 1}
              // At or above this, the springing line falls at or below
              // the panel's own bottom edge — no jamb, and the curve
              // starts extending outside the panel's own rect entirely.
              // See arch-geometry.ts's normalizeHeadRise.
              max={Math.max(Math.floor(props.heightMm) - 1, 1)}
            />
          </div>
        )}
      </div>

      {props.headShape !== HeadShape.FLAT && (
        <div>
          <FieldLabel htmlFor="panel-bars-toggle">{t('fields.barsSection')}</FieldLabel>
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              id="panel-bars-toggle"
              type="button"
              size="sm"
              variant={props.barDrawMode ? 'default' : 'outline'}
              aria-pressed={props.barDrawMode}
              onClick={() => props.onBarDrawModeChange(!props.barDrawMode)}
            >
              {props.barDrawMode ? t('fields.barsDrawingActive') : t('fields.barsDrawBar')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('fields.barsCount', { count: props.barCount })}</span>
          </div>
          {props.barDrawMode && <p className="mt-1.5 text-xs text-muted-foreground">{t('fields.barsDrawHint')}</p>}
        </div>
      )}

      {/* Shown once a bar is selected on the drawing — §7. */}
      {props.selectedBar && (
        <Section innerRef={barRef} title={t('windowDialog.design.sections.bar')} focused>
          <p className="text-xs text-muted-foreground">
            {props.selectedBar.lengthMm !== null
              ? t('windowDialog.design.barLength', { length: Math.round(props.selectedBar.lengthMm) })
              : t('windowDialog.design.barLengthUnknown')}
          </p>
          {/* Bow, or type the radius — §6.5. `line` and `arc` are never
              two separate tools, only two values of this one field:
              clearing it flattens the bar (`sagMm: 0`), typing a number
              bows it. A typed radius below the chord's own half-length
              can't fit — `onBarRadiusChange` clamps it server-side of
              the callback (`sagFromRadius`), and what's shown back here
              is always the ACTUAL current radius, so a too-small typed
              value visibly snaps to the real minimum rather than just
              silently accepting an impossible number. */}
          {props.selectedBar.minRadiusMm !== null && (
            <div>
              <FieldLabel htmlFor="bar-radius">{t('fields.barRadiusMm')}</FieldLabel>
              <Input
                id="bar-radius"
                className="mt-1.5"
                type="number"
                min={Math.ceil(props.selectedBar.minRadiusMm)}
                dir="ltr"
                placeholder="∞"
                value={props.selectedBar.radiusMm !== null ? Math.round(props.selectedBar.radiusMm) : ''}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw.trim() === '') {
                    props.onBarRadiusChange(null)
                    return
                  }
                  const parsed = Number(raw)
                  if (Number.isFinite(parsed)) props.onBarRadiusChange(parsed)
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {props.selectedBar.radiusMm === null ? t('fields.barRadiusStraight') : t('fields.barRadiusHint')}
              </p>
            </div>
          )}
          <Button type="button" size="sm" variant="destructive" onClick={props.onRequestDeleteBar}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t('fields.barsDeleteButton')}
          </Button>
        </Section>
      )}

      <div>
        <div ref={flyScreenRef} className="flex flex-wrap gap-2">
          <CheckboxChip
            checked={props.hasFlyScreen}
            disabled={!props.flyScreenAllowed}
            onCheckedChange={props.onFlyScreenChange}
            label={t('fields.hasFlyScreen')}
            focused={selectedPart?.kind === 'flyScreen'}
            title={!props.flyScreenAllowed ? t('fields.flyScreenDisabledHint') : undefined}
          />
          {props.showDoor && (
            <CheckboxChip checked={props.isDoor} onCheckedChange={props.onDoorChange} label={t('fields.isDoor')} />
          )}
        </div>
        <IssueList issues={flyScreenIssues} />
      </div>

      {props.showOpeningTypes && (
        <div>
          <FieldLabel htmlFor="panel-opening-type">{t('fields.openingTypeSection')}</FieldLabel>
          <div id="panel-opening-type" role="group" aria-label={t('fields.openingTypeSection')} className="mt-1.5 grid grid-cols-8 gap-1">
            {OPENING_TYPE_OPTIONS.map((type) => {
              const selected = props.openingType === type
              return (
                <button
                  key={type}
                  type="button"
                  title={t(`fields.openingTypeLabels.${type}`)}
                  aria-label={t(`fields.openingTypeLabels.${type}`)}
                  aria-pressed={selected}
                  onClick={() => props.onOpeningTypeChange(selected ? null : type)}
                  className={cn(
                    'flex items-center justify-center rounded-md border p-1 transition-colors',
                    selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground',
                  )}
                >
                  <OpeningTypeIcon type={type} className="size-full" />
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <ColorField
          id="panel-interior-color"
          label={t('fields.interiorColor')}
          placeholder={t('fields.colorPlaceholder')}
          value={props.interiorColor}
          options={props.colorOptions}
          onChange={props.onInteriorColorChange}
        />
        <ColorField
          id="panel-exterior-color"
          label={t('fields.exteriorColor')}
          placeholder={t('fields.colorPlaceholder')}
          value={props.exteriorColor}
          options={props.colorOptions}
          onChange={props.onExteriorColorChange}
        />
      </div>

      <Section innerRef={sashRef} title={t('windowDialog.design.sections.sash')} focused={selectedPart?.kind === 'sash'}>
        <div>
          <FieldLabel htmlFor="panel-sash" required>
            {t('fields.sashProfile')}
          </FieldLabel>
          <Select
            value={props.sashProfile || NONE}
            disabled={props.sashOptions.length === 0}
            onValueChange={(value) => {
              if (!value) return
              props.onSashChange(value as ScopedRef)
            }}
          >
            <SelectTrigger id="panel-sash" className="mt-1.5 w-full">
              <SelectValue
                placeholder={props.sashOptions.length === 0 ? t('fields.sashProfileNeedsFrame') : t('fields.sashProfilePlaceholder')}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} disabled>
                {t('fields.sashProfilePlaceholder')}
              </SelectItem>
              {props.sashOptions.map((opt) => (
                <SelectItem key={opt.id} value={formatScopedRef(opt.scope, opt.id)}>
                  {opt.profileNo} — {tLookups('fields.maxGlassThickness')}: {opt.maxGlassThickness}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sashPart && (
          <p className="text-xs text-muted-foreground">
            {t('windowDialog.design.computedSize', {
              width: Math.round(sashPart.rectMm.width),
              height: Math.round(sashPart.rectMm.height),
            })}
          </p>
        )}
        {props.sashWeightKg !== null && (
          <p
            className={cn(
              'text-xs',
              props.maxSashWeight !== null && props.sashWeightKg > props.maxSashWeight
                ? 'font-medium text-amber-600 dark:text-amber-500'
                : 'text-muted-foreground',
            )}
          >
            {t('windowDialog.design.sashWeight', {
              weight: Math.round(props.sashWeightKg * 10) / 10,
              max: props.maxSashWeight ?? '—',
            })}
          </p>
        )}
        {/* sashWeightExceeded is already shown above with its own
            computed-vs-allowed figures — don't repeat it as a plain
            issue line too. */}
        <IssueList issues={sashIssues.filter((i) => i.messageKey !== 'sashWeightExceeded')} />
      </Section>

      <Section innerRef={glassRef} title={t('windowDialog.design.sections.glass')} focused={selectedPart?.kind === 'glass'}>
        <div>
          <FieldLabel htmlFor="panel-glass" required>
            {t('fields.glass')}
          </FieldLabel>
          <Select
            value={props.glassValue}
            disabled={props.glassOptions.length === 0}
            onValueChange={(value) => {
              if (!value) return
              const [kind, ref] = value.split('|') as [GlassKind, ScopedRef]
              props.onGlassChange(kind, ref)
            }}
          >
            <SelectTrigger id="panel-glass" className="mt-1.5 w-full">
              <SelectValue
                placeholder={props.glassOptions.length === 0 ? t('fields.glassNeedsSash') : t('fields.glassPlaceholder')}
              />
            </SelectTrigger>
            <SelectContent>
              {props.glassOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.maxGlassAllowed !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('fields.glassDisclaimer', { max: props.maxGlassAllowed, sashMax: props.sashMaxGlassThickness })}
            </p>
          )}
        </div>
        {glassPart && (
          <p className="text-xs text-muted-foreground">
            {t('windowDialog.design.computedSize', {
              width: Math.round(glassPart.rectMm.width),
              height: Math.round(glassPart.rectMm.height),
            })}
          </p>
        )}
        <IssueList issues={glassIssues} />
      </Section>

      <div>
        <FieldLabel htmlFor="panel-location" optional>
          {t('fields.location')}
        </FieldLabel>
        <Input
          id="panel-location"
          className="mt-1.5"
          value={props.location ?? ''}
          onChange={(e) => props.onLocationChange(blankToNull(e.target.value))}
        />
      </div>

      <div>
        <FieldLabel htmlFor="panel-notes" optional>
          {t('fields.notes')}
        </FieldLabel>
        <Textarea
          id="panel-notes"
          className="mt-1.5"
          rows={3}
          value={props.notes ?? ''}
          onChange={(e) => props.onNotesChange(blankToNull(e.target.value))}
        />
      </div>
    </div>
  )
}

// Same blank->null rule as apps/web/src/lib/form-fields.ts's
// `optionalTextField` (a register()-only helper this panel can't use,
// since every field here is controlled) — an empty box means "clear
// it" (null), not "leave alone" (undefined never applies to a
// controlled input's own onChange).
function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** The "Panel N of M" row + delete button — shown only for a real
 * multi-panel assembly (a single-panel window/transom's delete button
 * lives at the dialog's own footer level instead, same as before this
 * ever needed a name). Exported: `transom-part-panel.tsx` uses this
 * exact same header — a second real call site, not a hypothetical
 * one. */
export function PanelHeader({
  panelIndex,
  panelCount,
  onDeletePanel,
  deleteDisabledReason,
}: {
  panelIndex: number
  panelCount: number
  onDeletePanel?: () => void
  deleteDisabledReason?: string
}) {
  const { t } = useTranslation('workspace')
  if (panelCount <= 1) return null
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
      <span className="text-xs font-medium">{t('windowDialog.design.panelOf', { index: panelIndex + 1, count: panelCount })}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
        disabled={!onDeletePanel}
        title={deleteDisabledReason ?? t('windowDialog.design.deletePanel')}
        aria-label={t('windowDialog.design.deletePanel')}
        onClick={() => onDeletePanel?.()}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}

export function Section({
  innerRef,
  title,
  focused,
  children,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>
  title: string
  focused: boolean
  children: React.ReactNode
}) {
  return (
    <div
      ref={innerRef}
      className={cn(
        'flex scroll-my-2 flex-col gap-3 rounded-lg border p-3 transition-colors',
        focused ? 'border-primary bg-primary/5' : 'border-transparent',
      )}
    >
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </div>
  )
}

function CheckboxChip({
  checked,
  disabled,
  onCheckedChange,
  label,
  focused,
  title,
}: {
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  focused?: boolean
  /** Shown as a native hover tooltip — used for the fly-screen chip's
   * "this frame doesn't accept one" explanation, which used to sit
   * permanently under the checkboxes and now only appears on hover. */
  title?: string
}) {
  return (
    <label
      title={title}
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
        focused ? 'border-primary bg-primary/5' : 'border-border',
        disabled && 'opacity-50',
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onCheckedChange(!!next)} />
      {label}
    </label>
  )
}

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

export function NumberField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  min = 1,
  max,
}: {
  id: string
  label: string
  value: number
  onChange: (mm: number) => void
  error?: string
  disabled?: boolean
  min?: number
  max?: number
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <Input
        id={id}
        className="mt-1.5"
        type="number"
        min={min}
        max={max}
        dir="ltr"
        disabled={disabled}
        aria-invalid={!!error}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ColorField({
  id,
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value: string | null
  options: WindowPartPanelColorOption[]
  onChange: (value: string | null) => void
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} optional>
        {label}
      </FieldLabel>
      <Select
        value={value ?? NONE}
        onValueChange={(next) => {
          if (!next) return
          onChange(next === NONE ? null : next)
        }}
      >
        <SelectTrigger id={id} className="mt-1.5 w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{placeholder}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-3 shrink-0 rounded-sm border border-border"
                  style={{ backgroundColor: opt.hex }}
                  aria-hidden="true"
                />
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
