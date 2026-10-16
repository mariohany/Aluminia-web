import { GlassKind, HeadShape, HingedOpeningType, SectionKind, type WindowSectionInput } from '@repo/types/windows'
import type { SystemType } from '@repo/types/lookups'
import type { SlidingLayoutInput } from '@repo/types/sliding'
import type { ScopedRef } from '@repo/types/company-lookups'
import type { WindowLayout } from '@repo/geometry/window-geometry'
import type { TranslatedIssue } from '@/lib/window-weight'
import type { MergedSystemProfileSummary } from '@/lib/lookup-merge'
import { PanelInspector } from '@/components/workspace/inspector/panel-inspector'
import { SectionInspector } from '@/components/workspace/inspector/section-inspector'
import { DividerInspector } from '@/components/workspace/inspector/divider-inspector'
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
 * view; a sash, glass or fly-screen part shows its Section view;
 * anything else (the frame, a panel row in the tree, nothing) shows the
 * Panel view. Name, location and notes live in the structure panel (§2).
 */
export function WindowPartPanel(props: WindowPartPanelProps) {
  const selectedPart = props.layout.parts.find((p) => p.id === props.selectedPartId) ?? null
  const level = inspectorLevel(selectedPart?.kind ?? null, props.selectedDivider !== null)

  if (level === 'panel') {
    // Same prefix rule as the structure tree's warning icon: every issue
    // on any of this panel's parts.
    const prefix = `p${props.panelIndex}:`
    const issues = [...props.issuesByPart].filter(([partId]) => partId.startsWith(prefix)).flatMap(([, list]) => list)
    return <PanelInspector props={props} issues={issues} />
  }
  if (level === 'section' || !props.selectedDivider) return <SectionInspector props={props} />
  return <DividerInspector props={props} divider={props.selectedDivider} />
}
