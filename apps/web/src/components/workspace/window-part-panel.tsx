import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { GlassKind, HeadShape, HingedOpeningType, SectionKind } from '@repo/types/windows'
import { ProfileType } from '@repo/types/lookups'
import type { SlidingLayoutInput } from '@repo/types/sliding'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import { sectionLetter, type WindowLayout, type WindowPartKind } from '@/lib/window-geometry'
import { dedupeIssues, type TranslatedIssue } from '@/lib/window-weight'
import type { MergedSystemProfileSummary } from '@/lib/lookup-merge'
import { minGothicRiseMm, normalizeHeadRise, type HeadOutline } from '@/lib/arch-geometry'
import { cn } from '@/lib/utils'
import { FieldLabel } from '@/components/workspace/field-label'
import { IssueList } from '@/components/workspace/issue-list'
import { SlidingLayoutEditor } from '@/components/workspace/sliding-layout-editor'
import { OpeningTypeIcon } from '@/components/icons/opening-type-icon'
import { archOutlinePath } from '@/components/workspace/window-shapes'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Radix rejects an empty-string item value — same sentinel window-editor-page.tsx uses.
const NONE = '__none'

// Grid order — one row of the four "primary" hinge/pivot ways a single
// leaf opens, then their mirrored/tilt-turn pairs, then the two-leaf
// families last (the less common picks). `FIXED_VERTICAL_MULLION`/
// `FIXED_HORIZONTAL_MULLION` are deliberately NOT offered here — a
// divider is the right tool for that now (docs/sections_planing.md's
// own stated default, "the section panel no longer offers them"). The
// enum values themselves stay (a saved section picked before Sections
// still resolves and draws exactly as before, per `window-geometry.ts`'s
// unchanged fixed-mullion branch) — only new picks are blocked.
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

/** Everything the active SECTION's own block needs — docs/
 * sections_planing.md §5: a Fixed/Opening toggle, and for opening —
 * sash, type, fly screen; glass for both; the section's own width/
 * height; indicative size and weight. One panel can show only one
 * section at a time — `window-editor-page.tsx` owns `activeSectionIndex`
 * and swaps this whole bundle when the selection moves to a different
 * section. */
export interface ActiveSectionProps {
  /** `row * cols + col` — matches every sash/glass/flyScreen part's own
   * `sectionIndex`, so this block can pick its parts straight out of
   * the panel's full layout without the caller pre-filtering them. */
  sectionIndex: number
  row: number
  col: number
  kind: SectionKind
  onKindChange: (kind: SectionKind) => void

  /** The section's own grid pitch — editable per docs/sections_planing.md's
   * assumption that resizing a section grows the PANEL (never steals
   * from a neighbour); `window-editor-page.tsx` routes this through
   * `resizeSection`. */
  widthMm: number
  heightMm: number
  onWidthChange: (mm: number) => void
  onHeightChange: (mm: number) => void

  // Opening-only.
  showOpeningTypes: boolean
  openingType: HingedOpeningType | null
  onOpeningTypeChange: (value: HingedOpeningType | null) => void
  sashProfile: string
  sashOptions: MergedSystemProfileSummary[]
  onSashChange: (ref: ScopedRef) => void
  sashWeightKg: number | null
  maxSashWeight: number | null
  hasFlyScreen: boolean
  flyScreenAllowed: boolean
  onFlyScreenChange: (value: boolean) => void

  // Sliding-only — docs/sliding_windows_planing.md §7. `isSliding` is
  // `systemType === SLIDING`, the sliding twin of `showOpeningTypes`;
  // the layout editor replaces the hinged type grid for such a section.
  // `slidingLayout` is `null` for a saved row from before the field
  // existed (decision 5) — the editor shows "pick a layout" rather than
  // inventing one. `slidingRails` is the FRAME PROFILE's rail count
  // (planing §11) — the editor shows it read-only and sizes its presets
  // and rows by it; `null` for a profile that has none.
  isSliding: boolean
  slidingLayout: SlidingLayoutInput | null
  slidingRails: number | null
  onSlidingLayoutChange: (layout: SlidingLayoutInput) => void

  // Fixed-only — the sash's counterpart for a fixed light's glass,
  // which sits straight in a glazing bead instead of a leaf.
  beadProfile: string
  beadOptions: MergedSystemProfileSummary[]
  onBeadChange: (ref: ScopedRef) => void

  // Glass — both kinds.
  glassValue: string
  glassOptions: WindowPartPanelGlassOption[]
  onGlassChange: (kind: GlassKind, ref: ScopedRef) => void
  maxGlassAllowed: number | null
  sashMaxGlassThickness: number | null
  beadMaxGlassThickness: number | null
}

/** Shown instead of the Section block when a DIVIDER is selected —
 * docs/sections_planing.md §5: its label (Mullion/Transom), the panel's
 * own divider profile (read-only here — it's edited once, above, not
 * per divider), its indicative length, and a Remove button. */
export interface SelectedDividerProps {
  /** Already-translated — "Mullion" or "Transom", from the divider's
   * own orientation. */
  label: string
  /** The resolved divider profile's own number, or `undefined` before
   * one is picked. */
  profileNumber: string | undefined
  lengthMm: number
  onRemove: () => void
}

export interface WindowPartPanelProps {
  /** The current drawing layout — Sash/Glass read their own part's
   * computed size from here directly, independent of what's selected,
   * since every section renders at once. */
  layout: WindowLayout
  /** Drives which section scrolls into view + gets the focus ring
   * (frame's own focus ring lives on window-editor-page.tsx's tree column
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
   * error is shown. window-editor-page.tsx only ever passes these once
   * `showValidation` is true (edit mode, or after a first submit
   * attempt in create mode) — see its own comment for why. */
  nameError?: string
  quantity: number
  onQuantityChange: (value: number) => void
  quantityError?: string

  /** The SELECTED PANEL's own outer size, not the assembly's — the
   * assembly's is derived from the panels' bounding box and shown
   * read-only on the drawing. `quantity` below really is the whole
   * assembly's: you order three of the unit, not three of panel 2. */
  widthMm: number
  heightMm: number
  onWidthChange: (mm: number) => void
  onHeightChange: (mm: number) => void
  widthError?: string
  heightError?: string

  // Head — arch_windows_planing.md §7. `headShapeAllowed` is
  // `canHaveArchedHead()` from window-geometry.ts — false disables the
  // shape buttons rather than letting the user pick a shape
  // `buildWindowLayout` would silently draw flat (sliding, double-door,
  // fixed-mullion, a hinged door, or — new with Sections — more than
  // one column). `headRiseReadOnly` is docs/sections_planing.md's own
  // rule: with more than one row the rise is DERIVED (pinned to the top
  // row's own pitch), so the Rise input goes read-only instead of
  // accepting a typed value that superRefine would just reject.
  headShape: HeadShape
  headRiseMm: number | null
  onHeadShapeChange: (shape: HeadShape) => void
  onHeadRiseChange: (mm: number) => void
  headShapeAllowed: boolean
  headRiseReadOnly: boolean
  /** Round needs rows === 1 (its rise is pinned to width / 2, which
   * can't survive a second row) — disabled distinctly from
   * `headShapeAllowed` so its own hint explains why, rather than
   * folding into the generic "not available" one. */
  roundDisallowedGridded: boolean

  // Bars — arch_windows_planing.md §6.1/§6.2. A persistent toggle (the
  // user's own chosen interaction, over a one-shot tool): it stays on
  // across multiple bars, and window-editor-page.tsx owns turning it back
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
   * highlight of what else goes with it, are owned by `WindowEditor`. */
  onRequestDeleteBar: () => void
  /** `null` clears the field, flattening the bar back to a line
   * (§6.5) — the radius input's own mirror of dragging the bow handle
   * to zero, not a separate control. */
  onBarRadiusChange: (radiusMm: number | null) => void

  showDoor: boolean
  isDoor: boolean
  onDoorChange: (value: boolean) => void

  interiorColor: string | null
  exteriorColor: string | null
  onInteriorColorChange: (value: string | null) => void
  onExteriorColorChange: (value: string | null) => void
  colorOptions: WindowPartPanelColorOption[]

  // Divider — docs/sections_planing.md decision 4: one profile per
  // panel, required from the first divider on. `isGridded` gates
  // whether the field shows at all (a 1×1 panel has no divider to
  // profile — the schema itself forbids one).
  isGridded: boolean
  dividerProfile: string | null
  onDividerProfileChange: (ref: ScopedRef) => void
  dividerProfileError?: string
  /** A mullion/transom is part of the same frame — its profile has to
   * come from the frame's own catalogue, a HARD restriction (Mario,
   * 2026-09-13), not merely the search-seed hint the frame/sash trees
   * use elsewhere. `undefined` before a frame is picked. */
  frameCatalogRef: string | undefined

  /** The active section's own block — always present (a fresh 1×1
   * panel's only section is active by default). */
  activeSection: ActiveSectionProps
  /** Non-null exactly when a divider is the selected part — shown
   * INSTEAD of the Section block, never alongside it (selecting one
   * always deselects the other on the drawing). */
  selectedDivider: SelectedDividerProps | null

  // Belongs to no drawn part — same posture as name/size/quantity above.
  location: string | null
  onLocationChange: (value: string | null) => void
  notes: string | null
  onNotesChange: (value: string | null) => void
}

/**
 * The dialog's fixed-width options column. Name, size/quantity, Head,
 * Bars, divider profile, and both colours sit at the top as plain panel-
 * level fields; below them, exactly one of the Section block (the
 * active section's own fixed/opening fields — headed "Section A" with
 * its own size only once a divider exists; a 1×1 panel's opening
 * fields are just more panel fields) or the Divider block (a
 * selected divider's label/profile/length/Remove) shows, followed by
 * location/notes. Clicking a sash/glass/fly-screen part on the drawing
 * scrolls the Section block into view; clicking a divider scrolls to
 * the Divider block instead.
 */
export function WindowPartPanel(props: WindowPartPanelProps) {
  const { t } = useTranslation('workspace')

  const sectionRef = useRef<HTMLDivElement>(null)
  const dividerRef = useRef<HTMLDivElement>(null)
  const flyScreenRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const sectionRefs: Partial<Record<WindowPartKind, React.RefObject<HTMLDivElement | null>>> = {
    sash: sectionRef,
    glass: sectionRef,
    flyScreen: flyScreenRef,
    divider: dividerRef,
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
            // curve than "round" promised. A gridded (rows > 1) panel
            // disables Round for a different reason — its rise can't
            // survive a second row at all.
            const roundDoesNotFit = shape === HeadShape.ROUND && props.widthMm / 2 >= props.heightMm
            const roundGridded = shape === HeadShape.ROUND && props.roundDisallowedGridded
            const disabled = !props.headShapeAllowed || roundDoesNotFit || roundGridded
            const disabledHint = !props.headShapeAllowed
              ? t('fields.headShapeDisabledHint')
              : roundGridded
                ? t('fields.headShapeRoundGriddedHint')
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
                // window-editor-page.tsx's handler always writes a fresh
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
              disabled={props.headShape === HeadShape.ROUND || props.headRiseReadOnly}
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
            {props.headRiseReadOnly && (
              <p className="mt-1 text-xs text-muted-foreground">{t('fields.headRiseGriddedHint')}</p>
            )}
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

      {props.showDoor && (
        <div className="flex flex-wrap gap-2">
          <CheckboxChip checked={props.isDoor} onCheckedChange={props.onDoorChange} label={t('fields.isDoor')} />
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

      {/* One divider profile for the whole panel (docs/sections_planing.md
          decision 4) — appears the first time a panel gains a divider,
          required from then on. */}
      {props.isGridded && (
        <div>
          <FieldLabel htmlFor="panel-divider-profile" required>
            {t('fields.dividerProfile')}
          </FieldLabel>
          <div id="panel-divider-profile" className="mt-1.5 h-40 min-h-0 rounded-md border border-border">
            <ProfileTreePicker
              profileType={ProfileType.TRANSOM}
              value={props.dividerProfile}
              onChange={props.onDividerProfileChange}
              catalogRef={props.frameCatalogRef}
            />
          </div>
          {props.dividerProfileError && <p className="mt-1 text-xs text-destructive">{props.dividerProfileError}</p>}
        </div>
      )}

      {props.selectedDivider ? (
        <Section innerRef={dividerRef} title={props.selectedDivider.label} focused>
          <p className="text-xs text-muted-foreground">
            {props.selectedDivider.profileNumber
              ? `${t('fields.dividerProfile')}: ${props.selectedDivider.profileNumber}`
              : t('fields.dividerProfileRequired')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('windowDialog.design.dividerLength', { length: Math.round(props.selectedDivider.lengthMm) })}
          </p>
          <Button type="button" size="sm" variant="destructive" onClick={props.selectedDivider.onRemove}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t('windowDialog.design.removeDivider')}
          </Button>
        </Section>
      ) : (
        <SectionBlock
          innerRef={sectionRef}
          flyScreenRef={flyScreenRef}
          section={props.activeSection}
          selectedPartKind={selectedPart?.kind ?? null}
          issuesByPart={props.issuesByPart}
          layout={props.layout}
          isGridded={props.isGridded}
        />
      )}

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

/** The active section's own block — a Fixed/Opening toggle, then
 * whichever fields that kind actually has, glass last (shared by both
 * kinds). Heading and section Width/Height only when `isGridded` (a
 * 1×1 panel has no sections to name or size — Mario, 2026-09-20).
 * `layout`/`issuesByPart` are the whole panel's — filtered here
 * by the section's own part ids (sash/glass/flyScreen carry a
 * `sectionIndex`; this block only ever shows ONE section's parts). */
function SectionBlock({
  innerRef,
  flyScreenRef,
  section,
  selectedPartKind,
  issuesByPart,
  layout,
  isGridded,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>
  flyScreenRef: React.RefObject<HTMLDivElement | null>
  section: ActiveSectionProps
  selectedPartKind: WindowPartKind | null
  issuesByPart: Map<string, TranslatedIssue[]>
  layout: WindowLayout
  isGridded: boolean
}) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')

  // This block always describes ONE section — the parts it draws from
  // are whichever sash/glass/flyScreen carry this exact `sectionIndex`,
  // out of the whole panel's layout (a gridded panel's `layout.parts`
  // holds every section's parts at once).
  const sectionParts = layout.parts.filter(
    (p) => (p.kind === 'sash' || p.kind === 'glass' || p.kind === 'flyScreen') && p.sectionIndex === section.sectionIndex,
  )
  const sashPart = sectionParts.find((p) => p.kind === 'sash')
  const glassPart = sectionParts.find((p) => p.kind === 'glass')
  const flyScreenPart = sectionParts.find((p) => p.kind === 'flyScreen')

  // A sliding sash's own build issues (`sliding*` keys, planing §8) show
  // under that sash's row in the layout editor, keyed by its index —
  // everything else on a sash part (sashRequired, weight) stays in the
  // section-level list under the sash Select below.
  const isSlidingIssue = (issue: TranslatedIssue) => issue.messageKey.startsWith('sliding')
  const slidingIssuesBySash = new Map<number, TranslatedIssue[]>()
  for (const part of sectionParts) {
    if (part.kind !== 'sash') continue
    const own = (issuesByPart.get(part.id) ?? []).filter(isSlidingIssue)
    if (own.length > 0) slidingIssuesBySash.set(part.index, own)
  }
  const sashIssues = dedupeIssues(
    sectionParts.filter((p) => p.kind === 'sash').flatMap((p) => (issuesByPart.get(p.id) ?? []).filter((i) => !isSlidingIssue(i))),
  )
  // A section-level sliding issue (`slidingLayoutRequired`,
  // `slidingOnHinged` — planing §12) lands on the section's first glass
  // part; it belongs under the layout tiles, not under the glass Select.
  const allGlassIssues = dedupeIssues(sectionParts.filter((p) => p.kind === 'glass').flatMap((p) => issuesByPart.get(p.id) ?? []))
  const slidingSectionIssues = allGlassIssues.filter(isSlidingIssue)
  const glassIssues = allGlassIssues.filter((i) => !isSlidingIssue(i))
  const flyScreenIssues = flyScreenPart ? (issuesByPart.get(flyScreenPart.id) ?? []) : []

  const isOpening = section.kind === SectionKind.OPENING

  // A panel is only "sectioned" from its first divider on (Mario,
  // 2026-09-20): a 1×1 panel's opening fields sit directly under the
  // panel's own — no SECTION heading, and no section Width/Height
  // (they'd just repeat the panel size). The letter matches the one
  // drawn on the elevation for this exact section (`sectionLetter`,
  // `window-drawing.tsx`).
  const title = isGridded ? `${t('windowDialog.design.sections.section')} ${sectionLetter(section.sectionIndex)}` : undefined

  return (
    <Section
      innerRef={innerRef}
      title={title}
      focused={selectedPartKind === 'sash' || selectedPartKind === 'glass' || selectedPartKind === 'flyScreen'}
    >
      {/* Only shown when there's no type/layout grid to fold this into
          (curtain-wall — `showOpeningTypes` is hinged-only, and the
          sliding tiles lead with their own Fixed tile since 2026-09-20):
          for a hinged section, the grid below already carries
          `FIXED_CLOSED`, so a separate Fixed/Opening toggle would just
          be two ways to say the same thing (Mario, 2026-09-13). */}
      {!section.showOpeningTypes && !section.isSliding && (
        <div role="group" aria-label={t('windowDialog.design.sections.section')} className="grid grid-cols-2 gap-1">
          {([SectionKind.FIXED, SectionKind.OPENING] as const).map((kind) => {
            const selected = section.kind === kind
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={selected}
                onClick={() => section.onKindChange(kind)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs transition-colors',
                  selected ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:border-muted-foreground',
                )}
              >
                {t(`windowDialog.design.section.kind.${kind}`)}
              </button>
            )
          })}
        </div>
      )}

      {isGridded && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            id="section-width"
            label={t('fields.widthMm')}
            value={section.widthMm}
            onChange={section.onWidthChange}
          />
          <NumberField
            id="section-height"
            label={t('fields.heightMm')}
            value={section.heightMm}
            onChange={section.onHeightChange}
          />
        </div>
      )}

      {!isOpening && (
        <div>
          <FieldLabel htmlFor="section-bead" required>
            {t('fields.beadProfile')}
          </FieldLabel>
          <Select
            value={section.beadProfile || NONE}
            disabled={section.beadOptions.length === 0}
            onValueChange={(value) => {
              if (!value) return
              section.onBeadChange(value as ScopedRef)
            }}
          >
            <SelectTrigger id="section-bead" className="mt-1.5 w-full">
              <SelectValue
                placeholder={section.beadOptions.length === 0 ? t('fields.beadProfileNeedsFrame') : t('fields.beadProfilePlaceholder')}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} disabled>
                {t('fields.beadProfilePlaceholder')}
              </SelectItem>
              {section.beadOptions.map((opt) => (
                <SelectItem key={opt.id} value={formatScopedRef(opt.scope, opt.id)}>
                  {opt.profileNo} — {tLookups('fields.maxGlassThickness')}: {opt.maxGlassThickness}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* beadRequired lands on this section's own glass part(s) (bug-055
              — a fixed section draws no separate bead part), so it comes out
              of `glassIssues` below; shown here instead, right under the
              actual field it's about. */}
          <IssueList issues={glassIssues.filter((i) => i.messageKey === 'beadRequired')} />
        </div>
      )}

      {isOpening && (
        <div ref={flyScreenRef} className="flex flex-wrap gap-2">
          <CheckboxChip
            checked={section.hasFlyScreen}
            disabled={!section.flyScreenAllowed}
            onCheckedChange={section.onFlyScreenChange}
            label={t('fields.hasFlyScreen')}
            focused={selectedPartKind === 'flyScreen'}
            title={!section.flyScreenAllowed ? t('fields.flyScreenDisabledHint') : undefined}
          />
        </div>
      )}
      {isOpening && <IssueList issues={flyScreenIssues} />}

      {/* Mounted for a FIXED sliding section too — its Fixed tile is the
          selected one then, and any preset tile is the way back. */}
      {section.isSliding && (
        <SlidingLayoutEditor
          layout={section.slidingLayout}
          rails={section.slidingRails}
          kind={section.kind}
          onFixed={() => section.onKindChange(SectionKind.FIXED)}
          onChange={section.onSlidingLayoutChange}
          issues={slidingSectionIssues}
          issuesBySash={slidingIssuesBySash}
        />
      )}

      {section.showOpeningTypes && (
        <div>
          <FieldLabel htmlFor="section-opening-type">{t('fields.openingTypeSection')}</FieldLabel>
          <div id="section-opening-type" role="group" aria-label={t('fields.openingTypeSection')} className="mt-1.5 grid grid-cols-8 gap-1">
            {OPENING_TYPE_OPTIONS.map((type) => {
              // `FIXED_CLOSED` doubles as the fixed/opening choice itself
              // now — a `FIXED` section has `openingType: null` (not
              // literally `FIXED_CLOSED`, per the schema), so it needs
              // its own selected check rather than the plain equality
              // every other icon uses.
              const selected =
                type === HingedOpeningType.FIXED_CLOSED
                  ? section.kind === SectionKind.FIXED || section.openingType === HingedOpeningType.FIXED_CLOSED
                  : section.openingType === type
              return (
                <button
                  key={type}
                  type="button"
                  title={t(`fields.openingTypeLabels.${type}`)}
                  aria-label={t(`fields.openingTypeLabels.${type}`)}
                  aria-pressed={selected}
                  onClick={() => section.onOpeningTypeChange(type)}
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

      {isOpening && (
        <div>
          <FieldLabel htmlFor="section-sash" required>
            {t('fields.sashProfile')}
          </FieldLabel>
          <Select
            value={section.sashProfile || NONE}
            disabled={section.sashOptions.length === 0}
            onValueChange={(value) => {
              if (!value) return
              section.onSashChange(value as ScopedRef)
            }}
          >
            <SelectTrigger id="section-sash" className="mt-1.5 w-full">
              <SelectValue
                placeholder={section.sashOptions.length === 0 ? t('fields.sashProfileNeedsFrame') : t('fields.sashProfilePlaceholder')}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} disabled>
                {t('fields.sashProfilePlaceholder')}
              </SelectItem>
              {section.sashOptions.map((opt) => (
                <SelectItem key={opt.id} value={formatScopedRef(opt.scope, opt.id)}>
                  {opt.profileNo} — {tLookups('fields.maxGlassThickness')}: {opt.maxGlassThickness}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sashPart && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('windowDialog.design.computedSize', {
                width: Math.round(sashPart.rectMm.width),
                height: Math.round(sashPart.rectMm.height),
              })}
            </p>
          )}
          {section.sashWeightKg !== null && (
            <p
              className={cn(
                'mt-1 text-xs',
                section.maxSashWeight !== null && section.sashWeightKg > section.maxSashWeight
                  ? 'font-medium text-amber-600 dark:text-amber-500'
                  : 'text-muted-foreground',
              )}
            >
              {t('windowDialog.design.sashWeight', {
                weight: Math.round(section.sashWeightKg * 10) / 10,
                max: section.maxSashWeight ?? '—',
              })}
            </p>
          )}
          {/* sashWeightExceeded is already shown above with its own
              computed-vs-allowed figures — don't repeat it as a plain
              issue line too. */}
          <IssueList issues={sashIssues.filter((i) => i.messageKey !== 'sashWeightExceeded')} />
        </div>
      )}

      <div>
        <FieldLabel htmlFor="section-glass" required>
          {t('fields.glass')}
        </FieldLabel>
        <Select
          value={section.glassValue}
          disabled={section.glassOptions.length === 0}
          onValueChange={(value) => {
            if (!value) return
            const [kind, ref] = value.split('|') as [GlassKind, ScopedRef]
            section.onGlassChange(kind, ref)
          }}
        >
          <SelectTrigger id="section-glass" className="mt-1.5 w-full">
            <SelectValue
              placeholder={
                section.glassOptions.length > 0
                  ? t('fields.glassPlaceholder')
                  : isOpening
                    ? t('fields.glassNeedsSash')
                    : t('fields.glassNeedsBead')
              }
            />
          </SelectTrigger>
          <SelectContent>
            {section.glassOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {section.maxGlassAllowed !== null &&
          (isOpening ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('fields.glassDisclaimer', { max: section.maxGlassAllowed, sashMax: section.sashMaxGlassThickness })}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('fields.glassDisclaimerBead', { max: section.maxGlassAllowed, beadMax: section.beadMaxGlassThickness })}
            </p>
          ))}
      </div>
      {glassPart && (
        <p className="text-xs text-muted-foreground">
          {t('windowDialog.design.computedSize', {
            width: Math.round(glassPart.rectMm.width),
            height: Math.round(glassPart.rectMm.height),
          })}
        </p>
      )}
      <IssueList issues={glassIssues.filter((i) => i.messageKey !== 'beadRequired')} />
    </Section>
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
 * multi-panel assembly (a single-panel window's delete button lives at
 * the dialog's own footer level instead, same as before this ever
 * needed a name). */
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
  /** Omitted for a 1×1 panel's opening block — it isn't a "section"
   * until a divider makes it one, so it gets no heading. */
  title?: string
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
      {title && <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>}
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
