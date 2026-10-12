import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { GlassKind, HeadShape, HingedOpeningType, SectionKind, type WindowSectionInput } from '@repo/types/windows'
import type { SystemType } from '@repo/types/lookups'
import { ProfileType } from '@repo/types/lookups'
import type { SlidingLayoutInput } from '@repo/types/sliding'
import type { ScopedRef } from '@repo/types/company-lookups'
import type { WindowLayout } from '@/lib/window-geometry'
import type { TranslatedIssue } from '@/lib/window-weight'
import type { MergedSystemProfileSummary } from '@/lib/lookup-merge'
import { cn } from '@/lib/utils'
import { FieldLabel } from '@/components/workspace/field-label'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PanelInspector } from '@/components/workspace/inspector/panel-inspector'
import { SectionInspector } from '@/components/workspace/inspector/section-inspector'
import { inspectorLevel } from '@/components/workspace/inspector/inspector-level'

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
  /** Matches every sash/glass/flyScreen part's own `sectionIndex` (the
   * light's place in display order), so this block can pick its parts
   * straight out of the panel's full layout. */
  sectionIndex: number
  kind: SectionKind
  /** An arch light other than the whole-arch one — fixed only (Q7,
   * docs/free_dividers_planing.md): no opening choices are offered. */
  fixedOnly: boolean
  onKindChange: (kind: SectionKind) => void

  /** The light's own boundary-to-boundary size — `null` for a shaped
   * arch light, which has no width/height to type. Typing one grows the
   * PANEL (Q14, `resizeLight`), never steals from a neighbour. */
  widthMm: number | null
  heightMm: number | null
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
  /** Present for an arch-zone divider, the only kind that bends (§6.5):
   * its radius (`null` while straight) and the tightest one its chord
   * allows, a half circle. */
  bend: { radiusMm: number | null; minMm: number; onChange: (mm: number | null) => void } | null
  /** Its own profile (Q12): `override` is set only when it differs from
   * the panel default, which the picker shows otherwise. */
  profile: { override: string | null; panelDefault: string | null; onChange: (ref: ScopedRef | null) => void }
  /** A straight mullion/transom's position (Q15) — mm from the left, or
   * up from the sill. `null` for an arch divider. */
  position: { axis: 'v' | 'h'; valueMm: number; onChange: (mm: number) => void } | null
  /** Each end, already translated: what it stands on and its cut. */
  ends: string[]
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

  /** The SELECTED PANEL's own outer size, not the assembly's — the
   * assembly's is derived from the panels' bounding box and shown
   * read-only on the drawing. (Quantity — the whole assembly's, not a
   * panel's — lives in the structure panel since the redesign.) */
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
  // or a hinged door).
  headShape: HeadShape
  headRiseMm: number | null
  /** The frame face — the arch springs on the sill, never inside it
   * (normalizeHeadRise). */
  frameFaceMm: number
  onHeadShapeChange: (shape: HeadShape) => void
  onHeadRiseChange: (mm: number) => void
  headShapeAllowed: boolean

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

  // Panel view (docs/inspector_redesign_planing.md §4).
  /** The frame-profile picker, moved here from the top of the aside. */
  frame: WindowPartPanelFrameProps
  systemType: SystemType | null
  /** The panel default divider profile's own number, for its row. */
  dividerProfileNo: string | undefined
  dividerCount: number
  /** The panel's sections, one per light in display order — the Lights list. */
  sections: WindowSectionInput[]
  /** Selects a part exactly like a click on the drawing — a Lights row
   * picks that light's glass, which opens its Section view. */
  onSelectPart: (partId: string) => void
}

export interface WindowPartPanelFrameProps {
  value: string | null
  /** The picked profile's number and catalogue, for the row. */
  profileNo: string | undefined
  catalogName: string | undefined
  /** `catalogue · brand · system` — the read-only System row. */
  systemName: string | undefined
  onChange: (ref: ScopedRef) => void
  favoriteRef?: string | null
  onSetFavorite?: (ref: ScopedRef) => void
  preferredCatalogRef?: string | null
  preferredBrandRef?: string | null
  /** Already-translated "required", once validation shows. */
  error?: string
}

/**
 * The inspector's body — docs/inspector_redesign_planing.md §3: ONE
 * level at a time, picked by the selection. A divider shows the Divider
 * block; a sash, glass or fly-screen part shows its Section block;
 * anything else (the frame, a panel row in the tree, nothing) shows the
 * Panel view. Name, location and notes live in the structure panel (§2).
 */
export function WindowPartPanel(props: WindowPartPanelProps) {
  const { t } = useTranslation('workspace')
  const dividerRef = useRef<HTMLDivElement>(null)

  const selectedPart = props.layout.parts.find((p) => p.id === props.selectedPartId) ?? null
  const level = inspectorLevel(selectedPart?.kind ?? null, props.selectedDivider !== null)

  if (level === 'panel') {
    // Same prefix rule as the structure tree's warning icon: every issue
    // on any of this panel's parts.
    const prefix = `p${props.panelIndex}:`
    const issues = [...props.issuesByPart].filter(([partId]) => partId.startsWith(prefix)).flatMap(([, list]) => list)
    return <PanelInspector props={props} issues={issues} />
  }
  if (level === 'section') return <SectionInspector props={props} />

  const divider = props.selectedDivider
  return (
    <div className="flex flex-col gap-4 px-3 pt-3 pb-4 text-sm">
      {level === 'divider' && divider ? (
      <Section innerRef={dividerRef} title={divider.label} focused>
        <div>
          <FieldLabel htmlFor="divider-profile">{t('windowDialog.design.dividerInspector.profile')}</FieldLabel>
          <p className="mt-1 text-xs text-muted-foreground">
            {divider.profileNumber
              ? divider.profile.override
                ? `${t('fields.dividerProfile')}: ${divider.profileNumber}`
                : t('windowDialog.design.dividerInspector.panelDefault', { profile: divider.profileNumber })
              : t('fields.dividerProfileRequired')}
          </p>
          <div id="divider-profile" className="mt-1.5 h-40 min-h-0 rounded-md border border-border">
            <ProfileTreePicker
              profileType={ProfileType.TRANSOM}
              value={divider.profile.override ?? divider.profile.panelDefault}
              onChange={divider.profile.onChange}
              catalogRef={props.frameCatalogRef}
            />
          </div>
          {divider.profile.override && (
            <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => divider.profile.onChange(null)}>
              {t('windowDialog.design.dividerInspector.useDefault')}
            </Button>
          )}
        </div>
        {divider.position && (
          <CommitNumberField
            id="divider-position"
            // Re-seeded when it moves from elsewhere (drag, nudge, undo).
            key={divider.position.valueMm}
            label={t(
              divider.position.axis === 'v'
                ? 'windowDialog.design.dividerInspector.fromLeft'
                : 'windowDialog.design.dividerInspector.fromSill',
            )}
            valueMm={divider.position.valueMm}
            onCommit={(mm) => mm !== null && divider.position?.onChange(mm)}
          />
        )}
        <p className="text-xs text-muted-foreground">
          {t('windowDialog.design.dividerLength', { length: Math.round(divider.lengthMm) })}
        </p>
        {divider.ends.map((line, i) => (
          <p key={i} className="text-xs text-muted-foreground" dir="auto">
            {line}
          </p>
        ))}
        {divider.bend && (
          <RadiusField
            // Re-seeded whenever the bend changes from elsewhere (the
            // drawing's handle, undo).
            key={divider.bend.radiusMm ?? 'straight'}
            {...divider.bend}
          />
        )}
        <Button type="button" size="sm" variant="destructive" onClick={divider.onRemove}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          {t('windowDialog.design.removeDivider')}
        </Button>
      </Section>
      ) : null}
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

/** A number committed on Enter or blur, not per key — typing "1500"
 * must not move or bend a divider through 1, 15 and 150 on the way.
 * Empty commits `null`. */
function CommitNumberField({
  id,
  label,
  valueMm,
  min,
  placeholder,
  hint,
  onCommit,
}: {
  id: string
  label: string
  valueMm: number | null
  min?: number
  placeholder?: string
  hint?: string
  onCommit: (mm: number | null) => void
}) {
  const [draft, setDraft] = useState(valueMm === null ? '' : String(valueMm))
  const commit = () => {
    const parsed = Number(draft)
    if (draft.trim() === '') onCommit(null)
    else if (Number.isFinite(parsed) && parsed > 0) onCommit(parsed)
  }
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        className="mt-1.5"
        type="number"
        min={min}
        dir="ltr"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A curved divider's radius. Empty means straight. */
function RadiusField({ radiusMm, minMm, onChange }: { radiusMm: number | null; minMm: number; onChange: (mm: number | null) => void }) {
  const { t } = useTranslation('workspace')
  return (
    <CommitNumberField
      id="divider-radius"
      label={t('windowDialog.design.dividerTool.radius')}
      valueMm={radiusMm}
      min={minMm}
      placeholder={t('windowDialog.design.dividerTool.straight')}
      hint={t('windowDialog.design.dividerTool.radiusHint', { min: minMm })}
      onCommit={onChange}
    />
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
