import { SystemType } from '@repo/types/lookups'
import { HingedOpeningType, HeadShape, SectionKind } from '@repo/types/windows'
import type { SlidingLayoutInput, SlidingOpeningType } from '@repo/types/sliding'
import { insetHeadOutline, normalizeHeadRise, type HeadOutline } from '@/lib/arch-geometry'
import type { ProfileMetrics } from '@/lib/profile-metrics'

// Every band width (frame face, sash face, bead, bars, dividers) comes
// in through `ProfileMetrics` (profile-metrics.ts) — resolved once per
// panel by the caller, never read from a module constant here, so real
// per-profile widths can arrive later without this file changing.

export type WindowPartKind = 'frame' | 'sash' | 'glass' | 'flyScreen' | 'divider'

export interface RectMm {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowPart {
  id: string
  kind: WindowPartKind
  /** Which sash/glass WITHIN its section, 0-based. 0 for frame/divider/
   * flyScreen and for a single-leaf sash. */
  index: number
  /** Which panel of the assembly this part belongs to — always 0 from
   * `buildWindowLayout()` (one panel's worth), rewritten by
   * `buildAssemblyLayout()`. The part's `id` carries the same number as
   * a `p<n>:` prefix; this is the parsed form, so a caller filtering
   * parts by panel doesn't have to do string work. */
  panelIndex: number
  /** Which grid cell this part belongs to (`row * cols + col`) — `null`
   * for a panel-level part (`frame`, `divider`), which belongs to no
   * one section. See docs/sections_planing.md §3. */
  sectionIndex: number | null
  rectMm: RectMm
  /** Set exactly when this part's outline is arched — absent (not
   * `null`) for a flat part, so `if (part.head)` is the one check every
   * consumer needs. Only ever set on the frame and the TOP ROW's own
   * sash/glass (`cols === 1` is a precondition for any of this, enforced
   * by `canHaveArchedHead`) — see `buildWindowLayout`'s `archable`. */
  head?: { shape: HeadShape; riseMm: number }
  /** Set exactly on a SLIDING section's sash parts, from the panel's
   * stored layout (docs/sliding_windows_planing.md §4): which rail this
   * sash runs on (0 = back/outside) and the way it slides, already
   * resolved. Face-relative facts — which neighbour is in front, which
   * edge is hidden — are the drawing's to derive from the neighbours'
   * rails and the face being viewed, not stored here. Absent on a
   * legacy sliding section (`sliding: null`), which still draws its old
   * two anonymous leaves. */
  sliding?: { rail: number; openingType: SlidingOpeningType }
}

/** One grid cell's worth of layout input — everything `buildWindowLayout`
 * needs to decide how a section draws, independent of what it's actually
 * glazed with (that's `useResolvedPanels`' job, not this file's). */
export interface WindowSectionLayoutInput {
  kind: typeof SectionKind.FIXED | typeof SectionKind.OPENING
  /** Whether a sash profile has been picked for this section. Until it
   * has — or when the opening type is `FIXED_CLOSED` — the section
   * draws as a FIXED light: bead, glass, no sash part at all (Mario,
   * 2026-09-13: "remove the sash from this window until another opening
   * type is selected"; "don't draw it until the user selects the
   * sash") — now decided per section rather than per panel. Ignored
   * whenever the panel's own `systemType` is sliding: an OPENING
   * sliding section always draws its leaves regardless of this flag
   * (a FIXED one is a single light either way). */
  hasSash: boolean
  /** A `HingedOpeningType`, meaningful only once the PANEL's frame
   * resolves to a hinged system — most values are purely decorative
   * (window-drawing.tsx draws a hinge/pivot symbol on the section's
   * existing sash+glass, no geometry change); the double-door and
   * fixed-mullion families are the exception, changing how many
   * leaves/lights this section builds. `null` on a fixed section
   * (enforced upstream) and optionally on an opening one too — see
   * `windowSectionSchema`'s own comment on why it's never required. */
  openingType: HingedOpeningType | null
  /** Fixed-only-by-convention (a fixed section is never sent one) —
   * mesh drawn over this section's own opening. */
  hasFlyScreen: boolean
  /** This section's own sliding layout (one entry per sash), read only
   * when the PANEL's `systemType` is sliding and this section is
   * opening. `null`/absent draws the legacy two-leaf shape every
   * sliding section had before the layout existed
   * (docs/sliding_windows_planing.md decision 5 — the drawing never
   * goes blank on an unmigrated row; the issue layer is what flags
   * it). Per section since planing §12 (a sliding panel can be divided
   * now). Optional so every pre-existing caller keeps compiling. */
  sliding?: SlidingLayoutInput | null
}

export interface WindowLayoutInput {
  widthMm: number
  heightMm: number
  systemType: SystemType | null
  flyScreenAllowed: boolean
  /** A hinged door has no sill — the opening (and its sash/glass/mesh)
   * runs flush to the frame's actual bottom edge instead of stopping a
   * frame-face short of it. Ignored for every other systemType. */
  isDoor: boolean
  /** `undefined`/`HeadShape.FLAT` behaves exactly as every panel did
   * before this feature. Optional so every pre-existing caller of
   * `buildWindowLayout` keeps compiling without change. */
  headShape?: HeadShape
  headRiseMm?: number | null
  /** The band widths this panel's profiles draw with — see
   * profile-metrics.ts. Resolved by the caller (`useResolvedPanels`),
   * one object per panel. */
  metrics: ProfileMetrics
  /** Boundary-to-boundary pitches, summing to `widthMm`/`heightMm` —
   * NOT clear glass sizes (docs/sections_planing.md decision 8). A
   * panel that was never touched by this feature is simply `[widthMm]`/
   * `[heightMm]`, a 1×1 grid. */
  columnWidths: number[]
  rowHeights: number[]
  /** Row-major (`row * cols + col`), length `columnWidths.length *
   * rowHeights.length` — every cell, exactly once. */
  sections: WindowSectionLayoutInput[]
}

// The four "two operable leaves, meeting flush at a shared centre
// stile, no sliding-style overlap" icons — see buildDoubleLeafSashRects.
export const DOUBLE_DOOR_OPENING_TYPES: HingedOpeningType[] = [
  HingedOpeningType.DOUBLE_DOOR_FRENCH_A,
  HingedOpeningType.DOUBLE_DOOR_FRENCH_B,
  HingedOpeningType.DOUBLE_DOOR_HANDLES_A,
  HingedOpeningType.DOUBLE_DOOR_HANDLES_B,
]

export interface WindowLayout {
  outerMm: { width: number; height: number }
  parts: WindowPart[]
}

/**
 * Pure geometry: no React, no lookups, no API. Sash count comes from
 * `systemType` — sliding draws one overlapping leaf per entry in each
 * opening section's `sliding` layout (two, `[0, 1]`, when it has none), hinged and
 * curtain_wall (and no frame chosen yet) draw one fixed leaf. Nothing
 * here is persisted; it's recomputed from the window's own fields on
 * every render.
 */

/**
 * Whether a panel's own frame/grid/top-row-opening-type combination can
 * support an arched head at all — independent of whether one is
 * currently set on it. Sliding and double-door both produce more than
 * one sash rect, a fixed-mullion opening type produces more than one
 * glass rect, a hinged door's asymmetric (no-bottom) inset has no
 * arch-aware equivalent yet (see docs/arch_windows_planing.md §5's
 * scope note: every arched-door reference photo turns out to be two
 * coupled PANELS in this assembly model, not one panel needing both at
 * once), and a vertical divider has nowhere to meet a curve (decision 5
 * — arches never span more than one column; a horizontal divider
 * UNDER an arch is fine, that's the whole point of this feature).
 *
 * `buildWindowLayout` uses this to decide whether to actually draw a
 * curve; `window-part-panel.tsx` uses the same predicate to decide
 * whether to let the user pick a shape in the first place, rather than
 * silently drawing flat after they do. One function, not a rule
 * duplicated in both places that could drift apart.
 */
export function canHaveArchedHead(
  input: Pick<WindowLayoutInput, 'isDoor' | 'systemType'> & {
    cols: number
    /** The `(row 0, col 0)` section's `openingType` — the only section
     * an arch ever touches, since `cols === 1` is required for any of
     * this. */
    topRowOpeningType: HingedOpeningType | null
  },
): boolean {
  const isHinged = input.systemType === SystemType.HINGED
  const isDoorHinged = input.isDoor && isHinged
  const isDoubleDoorHinged =
    isHinged && !!input.topRowOpeningType && DOUBLE_DOOR_OPENING_TYPES.includes(input.topRowOpeningType)
  const isMullion =
    isHinged &&
    (input.topRowOpeningType === HingedOpeningType.FIXED_VERTICAL_MULLION ||
      input.topRowOpeningType === HingedOpeningType.FIXED_HORIZONTAL_MULLION)
  return input.cols === 1 && !isDoorHinged && input.systemType !== SystemType.SLIDING && !isDoubleDoorHinged && !isMullion
}
/** `boundaries[0] === 0`, `boundaries[i] === sum(pitches[0..i))`,
 * `boundaries[pitches.length] === sum(pitches)` — one more entry than
 * `pitches` itself, so `boundaries[k]` is always "where column/row k
 * starts" for `k` up to and including `pitches.length`. Exported for the
 * drawing's own per-panel dimension chains (2026-09-14/15) — they need
 * the exact same boundary math `buildWindowLayout` uses internally,
 * not a second, potentially-drifting copy of it. */
export function cumulativeBoundaries(pitches: number[]): number[] {
  const boundaries = [0]
  let sum = 0
  for (const pitch of pitches) {
    sum += pitch
    boundaries.push(sum)
  }
  return boundaries
}

/** Spreadsheet-column letters for a row-major section index: 0→A, 1→B,
 * ... 25→Z, 26→AA, ... — Mario, 2026-09-14: "show sizes outside the
 * drawing" grew into labelling each section once dimension chains made
 * "which number belongs to which section" worth naming. Matches
 * `buildWindowLayout`'s own `row * cols + col` indexing, so the letter
 * shown on the drawing is always the same section the options panel is
 * editing. */
export function sectionLetter(index: number): string {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/** Rounds a stored mm value to 1 decimal, dropping a trailing ".0" —
 * "2,200" rather than "2,200.0" — but keeps a real fraction ("882.1")
 * exactly as stored. Every dimension callout on the drawing (assembly
 * H/W, per-panel column/row chains) goes through this, not a bare
 * `Math.round`, so a gridded panel's own fractional pitch (see
 * `insertColumn`/`insertRow`'s own rounding) never looks truncated. */
export function formatDimensionMm(mm: number): string {
  const rounded = Math.round(mm * 10) / 10
  return Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** The clear rect between frame/divider faces for grid cell `(row,
 * col)` — docs/sections_planing.md §3's pseudocode, verbatim. The
 * bottom ROW's own bottom edge is the one place `isDoorHinged` matters:
 * every other boundary is a real jamb or divider face. */
function sectionClearRect(
  row: number,
  col: number,
  xBoundaries: number[],
  yBoundaries: number[],
  frameFace: number,
  dividerFace: number,
  width: number,
  height: number,
  isDoorHinged: boolean,
): RectMm {
  const cols = xBoundaries.length - 1
  const rows = yBoundaries.length - 1
  const x0 = col === 0 ? frameFace : xBoundaries[col] + dividerFace / 2
  const x1 = col === cols - 1 ? width - frameFace : xBoundaries[col + 1] - dividerFace / 2
  const y0 = row === 0 ? frameFace : yBoundaries[row] + dividerFace / 2
  const y1 = row === rows - 1 ? height - (isDoorHinged ? 0 : frameFace) : yBoundaries[row + 1] - dividerFace / 2
  return { x: x0, y: y0, width: Math.max(x1 - x0, 1), height: Math.max(y1 - y0, 1) }
}

export function buildWindowLayout(input: WindowLayoutInput): WindowLayout {
  const width = Math.max(input.widthMm, 1)
  const height = Math.max(input.heightMm, 1)
  const { metrics } = input

  const isDoorHinged = input.isDoor && input.systemType === SystemType.HINGED
  const cols = input.columnWidths.length
  const rows = input.rowHeights.length
  const xBoundaries = cumulativeBoundaries(input.columnWidths)
  const yBoundaries = cumulativeBoundaries(input.rowHeights)

  const headShape = input.headShape ?? HeadShape.FLAT
  const topRowOpeningType = input.sections[0]?.openingType ?? null
  const archable =
    headShape !== HeadShape.FLAT && canHaveArchedHead({ isDoor: input.isDoor, systemType: input.systemType, cols, topRowOpeningType })

  // With more than one row, the springing line is the top divider's own
  // top edge (docs/sections_planing.md §1/§3, decided 2026-09-12): the
  // STORED rise is the top row's pitch (Zod pins it there exactly), and
  // the DRAWN rise is that minus half the divider face. With one row,
  // this is exactly `normalizeHeadRise`'s pre-existing behaviour —
  // unaffected by this feature.
  const riseMm =
    rows > 1
      ? Math.max((input.rowHeights[0] ?? 0) - metrics.dividerFace / 2, 1)
      : normalizeHeadRise(headShape, width, input.headRiseMm ?? 0, height)

  const frameOutline: HeadOutline = { rect: { x: 0, y: 0, width, height }, shape: headShape, riseMm }

  const parts: WindowPart[] = [
    {
      id: 'frame',
      kind: 'frame',
      index: 0,
      panelIndex: 0,
      sectionIndex: null,
      rectMm: { x: 0, y: 0, width, height },
      head: archable ? { shape: frameOutline.shape, riseMm: frameOutline.riseMm } : undefined,
    },
  ]

  // Dividers — every mullion runs the full opening height, every
  // transom the full opening width (decision 1); mullions pushed first,
  // transoms after, so the crossing reads as one piece either way
  // (decision 10 — no joint marks).
  const openingWidth = Math.max(width - 2 * metrics.frameFace, 1)
  const openingHeight = Math.max(height - metrics.frameFace - (isDoorHinged ? 0 : metrics.frameFace), 1)
  for (let k = 1; k < cols; k++) {
    parts.push({
      id: `div-v${k}`,
      kind: 'divider',
      index: k - 1,
      panelIndex: 0,
      sectionIndex: null,
      rectMm: { x: xBoundaries[k] - metrics.dividerFace / 2, y: metrics.frameFace, width: metrics.dividerFace, height: openingHeight },
    })
  }
  for (let j = 1; j < rows; j++) {
    parts.push({
      id: `div-h${j}`,
      kind: 'divider',
      index: j - 1,
      panelIndex: 0,
      sectionIndex: null,
      rectMm: { x: metrics.frameFace, y: yBoundaries[j] - metrics.dividerFace / 2, width: openingWidth, height: metrics.dividerFace },
    })
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sectionIndex = row * cols + col
      const section = input.sections[sectionIndex]
      if (!section) continue // Zod guarantees exact coverage; nothing to draw if it somehow didn't.

      const clearRect = sectionClearRect(row, col, xBoundaries, yBoundaries, metrics.frameFace, metrics.dividerFace, width, height, isDoorHinged)

      // Only the TOP row of a `cols === 1` panel can be arched — see
      // `canHaveArchedHead`. Its own outline is sized to just its own
      // rise: below the springing line is the next row (or the frame's
      // real bottom, if `rows === 1`), never a flat continuation of
      // THIS section — so `riseMm === rect.height` here, by
      // construction, not by further arithmetic.
      const sectionOutline: HeadOutline | null = archable && row === 0 ? { rect: clearRect, shape: headShape, riseMm: clearRect.height } : null

      const skipBottomInset = isDoorHinged && row === rows - 1
      buildSectionParts(parts, section, sectionIndex, clearRect, sectionOutline, metrics, input.flyScreenAllowed, input.systemType, skipBottomInset, section.sliding ?? null)
    }
  }

  return { outerMm: { width, height }, parts }
}

/** One grid cell's sash/glass/flyScreen parts — the per-panel branching
 * `buildWindowLayout` used to do (fixed light vs. sliding vs. double
 * door vs. fixed-mullion vs. plain single sash) now happens once per
 * SECTION instead of once per panel, operating on that section's own
 * `clearRect` exactly as it used to operate on the whole panel's inner
 * rect — a 1×1 grid (`clearRect === the old innerX/Y/Width/Height`)
 * produces byte-identical geometry to before this feature. `sliding`
 * is the section's own layout (planing §12: a sliding panel may be
 * gridded, each section fixed or sliding on its own). */
function buildSectionParts(
  parts: WindowPart[],
  section: WindowSectionLayoutInput,
  sectionIndex: number,
  clearRect: RectMm,
  archOutline: HeadOutline | null,
  metrics: ProfileMetrics,
  flyScreenAllowed: boolean,
  systemType: SystemType | null,
  skipBottomInset: boolean,
  sliding: SlidingLayoutInput | null,
): void {
  const isSliding = systemType === SystemType.SLIDING
  // Sliding ignores `hasSash`/`openingType` — it draws its leaves even
  // before a sash profile is picked (docs/sections_planing.md's
  // `WindowSectionLayoutInput` comment); a sliding section is never
  // archable, never mullion/double-door (those are `HingedOpeningType`
  // values, meaningless for a sliding frame). Its `kind` still counts, though:
  // a FIXED sliding section is one glazed light straight off the frame
  // (sliding decision 6), not two leaves — it drew the `[0, 1]` pair
  // until 2026-09-20 (bug-061).
  const isFixed =
    section.kind === SectionKind.FIXED ||
    (!isSliding && (!section.hasSash || section.openingType === HingedOpeningType.FIXED_CLOSED))
  const isDoubleDoorHinged = !isSliding && !!section.openingType && DOUBLE_DOOR_OPENING_TYPES.includes(section.openingType)
  const mullionAxis: 'vertical' | 'horizontal' | null = isSliding
    ? null
    : section.openingType === HingedOpeningType.FIXED_VERTICAL_MULLION
      ? 'vertical'
      : section.openingType === HingedOpeningType.FIXED_HORIZONTAL_MULLION
        ? 'horizontal'
        : null

  if (isFixed) {
    const glassOutline = archOutline ? insetHeadOutline(archOutline, metrics.beadFace) : null
    const opening = glassOutline ? glassOutline.rect : insetRect(clearRect, metrics.beadFace, skipBottomInset)
    // A fixed-mullion type still splits the light with its bar — the
    // bar is between the lights, sash or no sash.
    const glassRects = mullionAxis ? splitRectWithMullion(opening, mullionAxis, metrics.sashBarFace) : [opening]
    glassRects.forEach((glassRect, lightIndex) => {
      parts.push({
        id: `s${sectionIndex}:glass-0-${lightIndex}`,
        kind: 'glass',
        index: 0,
        panelIndex: 0,
        sectionIndex,
        rectMm: glassRect,
        head: glassOutline ? { shape: glassOutline.shape, riseMm: glassOutline.riseMm } : undefined,
      })
    })
    return
  }

  // A sliding section's leaves come from its own stored layout —
  // rail per sash, left → right — or, with no layout yet, the same
  // left-back / right-front pair every sliding panel drew before the
  // layout existed (`[0, 1]` is exactly the old two-leaf geometry, see
  // `buildSlidingSashRects`).
  const slidingRails: number[] | null = isSliding ? (sliding?.sashes.map((sash) => sash.rail) ?? [0, 1]) : null
  const sashRects: RectMm[] = slidingRails
    ? buildSlidingSashRects(clearRect.x, clearRect.y, clearRect.width, clearRect.height, metrics.slidingInterlock, slidingRails)
    : isDoubleDoorHinged
      ? buildDoubleLeafSashRects(clearRect.x, clearRect.y, clearRect.width, clearRect.height)
      : [clearRect]

  // Insetting the OUTLINE (not just the rect) keeps the same curve at
  // every layer, just smaller — see arch-geometry.ts's
  // `insetHeadOutline`. `null` whenever this section isn't the arched
  // top row (or there is none), so every branch below that reads it
  // falls through to the plain rectangular expression.
  const sashOutline = archOutline
  const glassOutline = sashOutline ? insetHeadOutline(sashOutline, metrics.sashFace) : null

  sashRects.forEach((rect, index) => {
    const useArch = !!sashOutline && index === 0 // archable implies exactly one sash — see canHaveArchedHead
    parts.push({
      id: `s${sectionIndex}:sash-${index}`,
      kind: 'sash',
      index,
      panelIndex: 0,
      sectionIndex,
      rectMm: useArch && sashOutline ? sashOutline.rect : rect,
      head: useArch && sashOutline ? { shape: sashOutline.shape, riseMm: sashOutline.riseMm } : undefined,
      sliding: sliding && isSliding ? { rail: sliding.sashes[index]?.rail ?? 0, openingType: sliding.sashes[index]?.openingType ?? 'free_sliding' } : undefined,
    })
    const opening = useArch && glassOutline ? glassOutline.rect : insetRect(rect, metrics.sashFace)
    // A fixed-mullion opening type splits ONE sash's glass into two
    // independently-selectable lights, split by a static bar (a real
    // structural member between two lights, not the decorative
    // Georgian grid) — every other opening type (including double-door,
    // which already gets two real sashes above) keeps the usual one
    // light per sash.
    const glassRects = mullionAxis ? splitRectWithMullion(opening, mullionAxis, metrics.sashBarFace) : [opening]
    glassRects.forEach((glassRect, lightIndex) => {
      parts.push({
        id: `s${sectionIndex}:glass-${index}-${lightIndex}`,
        kind: 'glass',
        index,
        panelIndex: 0,
        sectionIndex,
        rectMm: glassRect,
        head: useArch && glassOutline ? { shape: glassOutline.shape, riseMm: glassOutline.riseMm } : undefined,
      })
    })
  })

  // Only drawn once actually checked — no "ghost" preview of an unset
  // option, even when the frame would allow one. Fixed sections never
  // reach here (they return above) — matches decision 11: a fly screen
  // is opening-only.
  if (flyScreenAllowed && section.hasFlyScreen) {
    // A sliding frame's mesh runs on its own channel OUTSIDE the back
    // rail, one sash wide — so it sits behind the leftmost sash on the
    // lowest rail (docs/sliding_windows_planing.md, "Fly screen"
    // assumption). Rail 0 is the outside; with the legacy `[0, 1]`
    // fallback that is the LEFT leaf, where it used to be the right.
    const flyScreenRect = slidingRails
      ? (sashRects[slidingRails.indexOf(Math.min(...slidingRails))] ?? sashRects[0])
      : sashOutline
        ? sashOutline.rect
        : clearRect
    parts.push({
      id: `s${sectionIndex}:flyScreen`,
      kind: 'flyScreen',
      index: 0,
      panelIndex: 0,
      sectionIndex,
      rectMm: flyScreenRect,
      head: sashOutline ? { shape: sashOutline.shape, riseMm: sashOutline.riseMm } : undefined,
    })
  }
}

/**
 * N sliding leaves across one opening, left → right. Two neighbours on
 * DIFFERENT rails pass each other and so overlap by the interlock;
 * two on the SAME rail can't pass and simply abut — the prototype's
 * `overlaps[]` rule (docs/sliding_windows_planing.md §4). Every leaf
 * gets the same width, `(opening + Σ overlaps) / n`, so a 2-leaf
 * `[0, 1]` is exactly the old `width / 2 + interlock / 2` pair this
 * function always drew.
 */
export function buildSlidingSashRects(x: number, y: number, width: number, height: number, interlock: number, sashRails: readonly number[]): RectMm[] {
  const n = Math.max(sashRails.length, 1)
  const overlaps = sashRails.slice(1).map((rail, i) => (rail !== sashRails[i] ? interlock : 0))
  const totalOverlap = overlaps.reduce((sum, o) => sum + o, 0)
  const sashWidth = (width + totalOverlap) / n
  const rects: RectMm[] = []
  let cursor = x
  for (let i = 0; i < n; i++) {
    if (i > 0) cursor -= overlaps[i - 1] ?? 0
    rects.push({ x: cursor, y, width: sashWidth, height })
    cursor += sashWidth
  }
  return rects
}

// Two hinged leaves meeting flush in the middle — unlike
// buildSlidingSashRects, there's no overlap/interlock: a sliding sash
// needs one to physically pass behind the other, but two hinged leaves
// swing on their own outer edges and just abut at a shared centre
// stile. Each leaf's own `sashFace`-wide sash ring, sitting
// right next to its twin's, is what reads as a French door's centre
// mullion — no separate "mullion width" constant needed here.
function buildDoubleLeafSashRects(x: number, y: number, width: number, height: number): RectMm[] {
  const leafWidth = width / 2
  return [
    { x, y, width: leafWidth, height },
    { x: x + leafWidth, y, width: leafWidth, height },
  ]
}

// Splits one rect into two, separated by a static bar of `barWidth` —
// the fixed-mullion opening types' one structural divider between two
// independently-glazed lights.
function splitRectWithMullion(rect: RectMm, axis: 'vertical' | 'horizontal', barWidth: number): RectMm[] {
  if (axis === 'vertical') {
    const halfWidth = Math.max((rect.width - barWidth) / 2, 1)
    return [
      { x: rect.x, y: rect.y, width: halfWidth, height: rect.height },
      { x: rect.x + rect.width - halfWidth, y: rect.y, width: halfWidth, height: rect.height },
    ]
  }
  const halfHeight = Math.max((rect.height - barWidth) / 2, 1)
  return [
    { x: rect.x, y: rect.y, width: rect.width, height: halfHeight },
    { x: rect.x, y: rect.y + rect.height - halfHeight, width: rect.width, height: halfHeight },
  ]
}

/** `skipBottom`, when true, insets the top only, leaving the bottom
 * edge exactly where it was — a hinged door's bottom-row FIXED section
 * (its bead, same as the frame-face inset one level up) runs flush to
 * the floor same as the operable leaf next to it does. Every other
 * caller leaves this false: an operable sash's own bottom rail is real
 * material, unrelated to whether the FRAME has a sill underneath it. */
function insetRect(rect: RectMm, inset: number, skipBottom = false): RectMm {
  const width = Math.max(rect.width - 2 * inset, 1)
  const height = Math.max(rect.height - inset - (skipBottom ? 0 : inset), 1)
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + inset,
    width,
    height,
  }
}

// ---- Assemblies ------------------------------------------------------
//
// A window is a composition of coupled PANELS — each a whole unit with
// its own frame all the way round, joined to its neighbours along a
// shared edge. See docs/window_assembly_planing.md §1.
//
// Everything below is pure: no React, no lookups, no API, same as the
// single-panel geometry above. `apps/web` has no test runner (see the
// planing doc's assumptions), so these are written to be readable and
// individually checkable rather than relying on one.

/** Where a panel sits in the assembly's own mm space, origin top-left. */
export interface PanelPlacement {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

export type PanelSide = 'top' | 'bottom' | 'left' | 'right'
export const PANEL_SIDES: PanelSide[] = ['top', 'bottom', 'left', 'right']

/** One panel's worth of layout input, plus where it sits. No longer a
 * union on `panelType` — `PanelType`/the coupled transom panel are gone
 * (docs/sections_planing.md decision 3); every panel is this one shape,
 * mirroring `WindowPanelInput`'s own (packages/types/src/windows.ts). */
export type AssemblyPanelInput = PanelPlacement & WindowLayoutInput

export interface AssemblyLayout {
  outerMm: { width: number; height: number }
  parts: WindowPart[]
  /** Each panel's own outer rect, in assembly space, by index. */
  panelRects: RectMm[]
}

/**
 * The whole assembly's drawable parts.
 *
 * Calls `buildWindowLayout()` once per panel — that function is
 * deliberately untouched by this feature; it still knows exactly one
 * panel's worth of geometry — then offsets every rect into assembly
 * space and prefixes each part id with `p<i>:`. Selection, hover and
 * issue lookup all key off those prefixed ids, so nothing downstream
 * needs a second notion of "which panel".
 */
export function buildAssemblyLayout(panels: AssemblyPanelInput[]): AssemblyLayout {
  const parts: WindowPart[] = []
  const panelRects: RectMm[] = []

  panels.forEach((panel, panelIndex) => {
    const layout = buildWindowLayout(panel)
    panelRects.push({ x: panel.xMm, y: panel.yMm, width: layout.outerMm.width, height: layout.outerMm.height })
    for (const part of layout.parts) {
      parts.push({
        ...part,
        id: `p${panelIndex}:${part.id}`,
        panelIndex,
        rectMm: offsetRect(part.rectMm, panel.xMm, panel.yMm),
      })
    }
  })

  const outer = unionRect(panelRects)
  // Width/height, not the union's x/y — a normalised assembly starts at
  // (0,0), and the drawing's viewBox is built from the size alone.
  return { outerMm: { width: outer.width, height: outer.height }, parts, panelRects }
}

/** `"p1:s0:sash-0"` → `{ panelIndex: 1, localId: "s0:sash-0", sectionIndex:
 * 0 }`; `"p1:div-v1"` → `sectionIndex: null` (a panel-level part belongs
 * to no one section); `null` for an unprefixed id (a single-panel
 * `buildWindowLayout()` result, or the assembly-level `'assembly'` issue
 * id). Every part already carries its own `sectionIndex` field — this is
 * for the (rarer) case of parsing an id string with nothing else at
 * hand. */
export function parsePartId(partId: string): { panelIndex: number; localId: string; sectionIndex: number | null } | null {
  const match = /^p(\d+):(.+)$/.exec(partId)
  if (!match) return null
  const localId = match[2]
  const sectionMatch = /^s(\d+):/.exec(localId)
  return { panelIndex: Number(match[1]), localId, sectionIndex: sectionMatch ? Number(sectionMatch[1]) : null }
}

export function panelRect(panel: PanelPlacement): RectMm {
  return { x: panel.xMm, y: panel.yMm, width: panel.widthMm, height: panel.heightMm }
}

export function unionRect(rects: RectMm[]): RectMm {
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Length of the overlap between two 1-D spans; 0 or less means none. */
function spanOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

/** Positive-area intersection. Panels sharing only an edge do NOT overlap. */
export function panelsOverlap(a: PanelPlacement, b: PanelPlacement): boolean {
  return (
    spanOverlap(a.xMm, a.xMm + a.widthMm, b.xMm, b.xMm + b.widthMm) > 0 &&
    spanOverlap(a.yMm, a.yMm + a.heightMm, b.yMm, b.yMm + b.heightMm) > 0
  )
}

/**
 * Two panels are coupled when they share an edge SEGMENT of non-zero
 * length. Corner contact is deliberately not adjacency — two units
 * meeting at a point are not joined in any physical sense. Mirrors
 * `edgesTouch` in WindowsService, which enforces the same rule
 * server-side.
 */
export function panelsTouch(a: PanelPlacement, b: PanelPlacement): boolean {
  const verticallyAligned = spanOverlap(a.yMm, a.yMm + a.heightMm, b.yMm, b.yMm + b.heightMm) > 0
  const horizontallyAligned = spanOverlap(a.xMm, a.xMm + a.widthMm, b.xMm, b.xMm + b.widthMm) > 0
  const sideBySide = a.xMm + a.widthMm === b.xMm || b.xMm + b.widthMm === a.xMm
  const stacked = a.yMm + a.heightMm === b.yMm || b.yMm + b.heightMm === a.yMm
  return (sideBySide && verticallyAligned) || (stacked && horizontallyAligned)
}

/** True iff `other` sits directly on top of `panel` — `other`'s bottom
 * edge coincides with `panel`'s own top edge, with their x-spans
 * overlapping. The directional half of `panelsTouch`'s "stacked" case:
 * `archObstructed` (`window-weight.ts`'s `collectWindowIssues`) only
 * cares about this one direction — a panel resting on an arched
 * panel's own curved head carves a void inside the assembly rather
 * than at its outline, unlike a panel touching any other edge. */
export function touchesTopEdge(panel: PanelPlacement, other: PanelPlacement): boolean {
  const horizontallyAligned = spanOverlap(panel.xMm, panel.xMm + panel.widthMm, other.xMm, other.xMm + other.widthMm) > 0
  return horizontallyAligned && other.yMm + other.heightMm === panel.yMm
}

/** Every panel reachable from the first by shared edges. */
export function panelsConnected(panels: PanelPlacement[]): boolean {
  if (panels.length <= 1) return true
  const seen = new Set<number>([0])
  const queue = [0]
  while (queue.length > 0) {
    const current = queue.shift() as number
    for (let i = 0; i < panels.length; i++) {
      if (seen.has(i) || !panelsTouch(panels[current], panels[i])) continue
      seen.add(i)
      queue.push(i)
    }
  }
  return seen.size === panels.length
}

/**
 * Do these panels exactly fill their own bounding box? Given they don't
 * overlap (an invariant everywhere this is called), summed area equal to
 * the bounding box's area is both necessary and sufficient — no need to
 * walk a coverage grid.
 *
 * `false` is legal, not an error: it's the stepped, L-shaped assembly
 * the user explicitly asked to be allowed. The dialog surfaces it as an
 * amber note; the API accepts it.
 */
export function tilesExactly(panels: PanelPlacement[]): boolean {
  if (panels.length === 0) return false
  const box = unionRect(panels.map(panelRect))
  const covered = panels.reduce((sum, p) => sum + p.widthMm * p.heightMm, 0)
  return covered === box.width * box.height
}

/**
 * Which sides of `selection`'s bounding box a new panel could attach to.
 *
 * A side is free only when nothing outside the selection reaches past
 * that line anywhere along the box's cross-span — not merely when
 * nothing is flush against it. A panel sitting beyond a gap still blocks
 * the side, because a new panel placed there could run straight into it.
 *
 * `hasArchedHead`, when given, refuses 'top' outright whenever a panel
 * forming the selection's own top row is arched — a panel resting there
 * would carve a void inside the assembly rather than sit at its
 * outline, the same problem `archObstructed` (window-weight.ts) warns
 * about for geometry that predates this rule or reaches it some other
 * way (a resize, imported data). This is the harder rule for the
 * ADD-PANEL affordance itself: never even offer it, rather than offer
 * it and warn after the fact.
 */
export function freeSidesOf(
  selection: PanelPlacement[],
  all: PanelPlacement[],
  hasArchedHead?: (panel: PanelPlacement) => boolean,
): PanelSide[] {
  if (selection.length === 0) return []
  const box = unionRect(selection.map(panelRect))
  const others = all.filter((p) => !selection.includes(p))
  const topRowIsArched = !!hasArchedHead && selection.some((p) => p.yMm === box.y && hasArchedHead(p))

  return PANEL_SIDES.filter((side) => {
    if (side === 'top' && topRowIsArched) return false
    if (side === 'left' || side === 'right') {
      const line = side === 'right' ? box.x + box.width : box.x
      return !others.some((p) => {
        if (spanOverlap(p.yMm, p.yMm + p.heightMm, box.y, box.y + box.height) <= 0) return false
        return side === 'right' ? p.xMm + p.widthMm > line : p.xMm < line
      })
    }
    const line = side === 'bottom' ? box.y + box.height : box.y
    return !others.some((p) => {
      if (spanOverlap(p.xMm, p.xMm + p.widthMm, box.x, box.x + box.width) <= 0) return false
      return side === 'bottom' ? p.yMm + p.heightMm > line : p.yMm < line
    })
  })
}

/**
 * What the "+" popup should pre-fill, per the user's own rule: attaching
 * above or below matches the selection's WIDTH, attaching left or right
 * matches its HEIGHT — and for a multi-panel selection that's the union,
 * so two stacked panels offer their combined height. The other
 * dimension comes from the panel being cloned.
 */
export function prefillForSide(
  side: PanelSide,
  selection: PanelPlacement[],
  source: PanelPlacement,
): { widthMm: number; heightMm: number } {
  const box = unionRect(selection.map(panelRect))
  return side === 'top' || side === 'bottom'
    ? { widthMm: box.width, heightMm: source.heightMm }
    : { widthMm: source.widthMm, heightMm: box.height }
}

/**
 * Places a new panel against `side` of the selection, aligned to that
 * side's leading edge (left for top/bottom, top for left/right), then
 * re-normalises the origin.
 *
 * Returns `null` when the result would overlap something — which the
 * free-side check already prevents at the pre-filled size, but not once
 * the user enlarges the cross-dimension past the selection's span. The
 * popup surfaces that rather than silently clamping the number the user
 * just typed.
 */
export function insertPanel<T extends PanelPlacement>(
  panels: T[],
  side: PanelSide,
  selection: T[],
  newPanel: T,
): T[] | null {
  const box = unionRect(selection.map(panelRect))
  const placed: T = {
    ...newPanel,
    xMm: side === 'left' ? box.x - newPanel.widthMm : side === 'right' ? box.x + box.width : box.x,
    yMm: side === 'top' ? box.y - newPanel.heightMm : side === 'bottom' ? box.y + box.height : box.y,
  }
  if (panels.some((p) => panelsOverlap(p, placed))) return null
  return normalizeOrigin([...panels, placed])
}

/**
 * Which panels beyond the target's RIGHT edge should be pushed when its
 * width changes — the whole run, not just the immediate neighbour
 * (pushing only that one would drive it into the next panel along), but
 * only where the run is actually a run: a candidate that also touches
 * some OTHER, non-moving panel along its own left edge is a panel
 * bridging two separately-resized columns (a header sitting across
 * several bays, say) and has to stay put, not follow just one of them.
 *
 * Two passes over the ORIGINAL (unmutated) panels: first find every
 * panel beyond the edge that shares target's vertical span (the naive
 * single-hop candidates); then drop any candidate whose own left edge
 * also rests against a panel that ISN'T the target and isn't itself
 * still a candidate — propagated to a fixed point, so excluding a
 * bridging panel also excludes anything resting only on IT.
 *
 * A candidate with no exact neighbour on its left edge at all (an
 * assembly mid-edit can be momentarily non-flush) is left in — there's
 * nothing to disqualify it against, and refusing to move it would be a
 * silent regression from the plain single-hop behaviour this replaces.
 */
function panelsPushedRight<T extends PanelPlacement>(panels: T[], targetIndex: number, target: T): Set<number> {
  const rightEdge = target.xMm + target.widthMm
  const candidate = panels.map(
    (panel, i) =>
      i !== targetIndex &&
      panel.xMm >= rightEdge &&
      spanOverlap(panel.yMm, panel.yMm + panel.heightMm, target.yMm, target.yMm + target.heightMm) > 0,
  )

  const excluded = new Array(panels.length).fill(false)
  let changed = true
  while (changed) {
    changed = false
    candidate.forEach((isCandidate, i) => {
      if (!isCandidate || excluded[i]) return
      const panel = panels[i]
      const hasOutsideAnchor = panels.some((other, j) => {
        if (j === i) return false
        if (other.xMm + other.widthMm !== panel.xMm) return false
        if (spanOverlap(panel.yMm, panel.yMm + panel.heightMm, other.yMm, other.yMm + other.heightMm) <= 0) {
          return false
        }
        return j !== targetIndex && !(candidate[j] && !excluded[j])
      })
      if (hasOutsideAnchor) {
        excluded[i] = true
        changed = true
      }
    })
  }

  const result = new Set<number>()
  candidate.forEach((isCandidate, i) => {
    if (isCandidate && !excluded[i]) result.add(i)
  })
  return result
}

/** Mirror of `panelsPushedRight()` for a height change: panels resting
 * ABOVE the target's old top edge, excluding any that also rest on a
 * non-moving panel along their own bottom edge. See that function's
 * comment for the shared reasoning. */
function panelsPushedUp<T extends PanelPlacement>(panels: T[], targetIndex: number, target: T): Set<number> {
  const oldTopEdge = target.yMm
  const candidate = panels.map(
    (panel, i) =>
      i !== targetIndex &&
      panel.yMm + panel.heightMm <= oldTopEdge &&
      spanOverlap(panel.xMm, panel.xMm + panel.widthMm, target.xMm, target.xMm + target.widthMm) > 0,
  )

  const excluded = new Array(panels.length).fill(false)
  let changed = true
  while (changed) {
    changed = false
    candidate.forEach((isCandidate, i) => {
      if (!isCandidate || excluded[i]) return
      const panel = panels[i]
      const bottomEdge = panel.yMm + panel.heightMm
      const hasOutsideAnchor = panels.some((other, j) => {
        if (j === i) return false
        if (other.yMm !== bottomEdge) return false
        if (spanOverlap(panel.xMm, panel.xMm + panel.widthMm, other.xMm, other.xMm + other.widthMm) <= 0) {
          return false
        }
        return j !== targetIndex && !(candidate[j] && !excluded[j])
      })
      if (hasOutsideAnchor) {
        excluded[i] = true
        changed = true
      }
    })
  }

  const result = new Set<number>()
  candidate.forEach((isCandidate, i) => {
    if (isCandidate && !excluded[i]) result.add(i)
  })
  return result
}

/** Mirror of `panelsPushedRight()` for a LEFT-edge drag: panels resting
 * to the LEFT of the target's OLD left edge, excluding any that also
 * rest on a non-moving panel along their own RIGHT edge. See
 * `panelsPushedRight()`'s comment for the shared reasoning — this is
 * the same fixed-point exclusion, mirrored onto the opposite axis
 * direction for `resizePanelEdge()`'s 'left' side (dragging the FREE
 * left edge of a panel that has nothing else anchoring its width). */
function panelsPushedLeft<T extends PanelPlacement>(panels: T[], targetIndex: number, target: T): Set<number> {
  const leftEdge = target.xMm
  const candidate = panels.map(
    (panel, i) =>
      i !== targetIndex &&
      panel.xMm + panel.widthMm <= leftEdge &&
      spanOverlap(panel.yMm, panel.yMm + panel.heightMm, target.yMm, target.yMm + target.heightMm) > 0,
  )

  const excluded = new Array(panels.length).fill(false)
  let changed = true
  while (changed) {
    changed = false
    candidate.forEach((isCandidate, i) => {
      if (!isCandidate || excluded[i]) return
      const panel = panels[i]
      const hasOutsideAnchor = panels.some((other, j) => {
        if (j === i) return false
        if (other.xMm !== panel.xMm + panel.widthMm) return false
        if (spanOverlap(panel.yMm, panel.yMm + panel.heightMm, other.yMm, other.yMm + other.heightMm) <= 0) {
          return false
        }
        return j !== targetIndex && !(candidate[j] && !excluded[j])
      })
      if (hasOutsideAnchor) {
        excluded[i] = true
        changed = true
      }
    })
  }

  const result = new Set<number>()
  candidate.forEach((isCandidate, i) => {
    if (isCandidate && !excluded[i]) result.add(i)
  })
  return result
}

/** Mirror of `panelsPushedUp()` for a BOTTOM-edge drag: panels resting
 * BELOW the target's OLD bottom edge, excluding any that also rest on
 * a non-moving panel along their own TOP edge. See `panelsPushedUp()`'s
 * comment for the shared reasoning — used by `resizePanelEdge()`'s
 * 'bottom' side. */
function panelsPushedDown<T extends PanelPlacement>(panels: T[], targetIndex: number, target: T): Set<number> {
  const bottomEdge = target.yMm + target.heightMm
  const candidate = panels.map(
    (panel, i) =>
      i !== targetIndex &&
      panel.yMm >= bottomEdge &&
      spanOverlap(panel.xMm, panel.xMm + panel.widthMm, target.xMm, target.xMm + target.widthMm) > 0,
  )

  const excluded = new Array(panels.length).fill(false)
  let changed = true
  while (changed) {
    changed = false
    candidate.forEach((isCandidate, i) => {
      if (!isCandidate || excluded[i]) return
      const panel = panels[i]
      const topEdge = panel.yMm
      const hasOutsideAnchor = panels.some((other, j) => {
        if (j === i) return false
        if (other.yMm + other.heightMm !== topEdge) return false
        if (spanOverlap(panel.xMm, panel.xMm + panel.widthMm, other.xMm, other.xMm + other.widthMm) <= 0) {
          return false
        }
        return j !== targetIndex && !(candidate[j] && !excluded[j])
      })
      if (hasOutsideAnchor) {
        excluded[i] = true
        changed = true
      }
    })
  }

  const result = new Set<number>()
  candidate.forEach((isCandidate, i) => {
    if (isCandidate && !excluded[i]) result.add(i)
  })
  return result
}

/**
 * Resizes one panel by MOVING ITS COUPLING LINE — but only the panels
 * that line actually couples. Width is LEFT-anchored: the panel's own
 * left edge never moves, so widening moves its right edge by Δ, and
 * every panel that lies BEYOND that edge *and* shares part of the
 * panel's own vertical span is pushed by Δ, keeping its own size.
 * Height is BOTTOM-anchored, deliberately the opposite corner: the
 * panel's own bottom edge never moves, so a height change moves its TOP
 * edge, and every panel that rests ABOVE that edge (its own bottom sits
 * at or above the target's old top) *and* shares part of the target's
 * horizontal span is pushed by the same amount.
 *
 * The two axes anchor to different corners on purpose. Every panel
 * below the one being resized is standing on a floor that has to stay
 * put — nothing in the assembly has a reason to expect the ground to
 * move out from under it just because a panel above it changed size.
 * Width has no equivalent physical floor, so it keeps growing away from
 * the edge the user actually reads dimensions from (the left).
 *
 * That is what physically happens when you widen one leaf of a coupled
 * unit: the shared mullion moves and everything further along that run
 * moves with it, instead of a gap tearing open — while a panel in
 * another row or column, joined at a different mullion, is left alone.
 * A panel is therefore never resized by editing a different panel; the
 * assembly may end up stepped, which is legal (decision 2's L-shape).
 * See docs/window_assembly_planing.md §1.
 *
 * The push is the whole run beyond the edge, not just the panel flush
 * against it — pushing only the immediate neighbour would drive it into
 * the next panel along. But a panel bridging several columns/rows at
 * once (resting on more than one independently-resizable neighbour, like
 * a header across three bays) is never part of any one run — moving it
 * for ONE of those neighbours would overlap the others, which never
 * moved. `panelsPushedRight()`/`panelsPushedUp()` refuse to include it.
 *
 * Overlap tests use the target's ORIGINAL rect, so width and height in
 * the same call are independent of each other and of argument order.
 * The 1mm floor applies to the edited panel only: nothing else changes
 * size, so nothing else can be squeezed past it.
 */
export function resizePanel<T extends PanelPlacement>(
  panels: T[],
  index: number,
  widthMm: number,
  heightMm: number,
): T[] {
  const target = panels[index]
  if (!target) return panels
  const nextWidth = Math.max(Math.round(widthMm), 1)
  const nextHeight = Math.max(Math.round(heightMm), 1)
  if (nextWidth === target.widthMm && nextHeight === target.heightMm) return panels

  // A brand-new panel's previous size is NaN (`emptyPanel()`) — there's
  // no real edge yet to anchor against, so its first real size doesn't
  // shift anything. `Number.isFinite` rather than reusing the NaN
  // itself keeps that first assignment from poisoning yMm/xMm below.
  const dW = Number.isFinite(target.widthMm) ? nextWidth - target.widthMm : 0
  const dH = Number.isFinite(target.heightMm) ? nextHeight - target.heightMm : 0

  const pushedRight = dW !== 0 ? panelsPushedRight(panels, index, target) : null
  const pushedUp = dH !== 0 ? panelsPushedUp(panels, index, target) : null

  const resized = panels.map((panel, i) => {
    if (i === index) {
      return { ...panel, yMm: panel.yMm - dH, widthMm: nextWidth, heightMm: nextHeight }
    }
    let next = panel
    if (pushedRight?.has(i)) next = { ...next, xMm: next.xMm + dW }
    if (pushedUp?.has(i)) next = { ...next, yMm: next.yMm - dH }
    return next
  })

  return normalizeOrigin(resized)
}

/** Screen-space alignment tolerance is the drawing's job (`window-drawing.tsx`
 * converts a fixed pixel radius to mm via its own CTM scale, same as the
 * bar-drawing snap); this just answers the pure geometry question once
 * given an mm tolerance. The nearest OTHER panel edge on the given axis
 * within `toleranceMm` of `positionMm` — checked against BOTH edges of
 * every other panel (e.g. left AND right for the x axis), since either
 * is a legitimate "flush with" target, not just the far one. `null`
 * when nothing is close enough. Used by the drawing's outer-edge drag
 * to light up (and, per Mario, snap onto) a flush alignment with any
 * OTHER panel coupled into the same assembly — not a comparison against
 * some other window's stored size. */
export function alignedEdgeMm<T extends PanelPlacement>(
  panels: T[],
  excludeIndex: number,
  axis: 'x' | 'y',
  positionMm: number,
  toleranceMm: number,
): number | null {
  let best: number | null = null
  let bestDist = Infinity
  panels.forEach((panel, i) => {
    if (i === excludeIndex) return
    const edges = axis === 'x' ? [panel.xMm, panel.xMm + panel.widthMm] : [panel.yMm, panel.yMm + panel.heightMm]
    for (const edge of edges) {
      const dist = Math.abs(edge - positionMm)
      if (dist <= toleranceMm && dist < bestDist) {
        best = edge
        bestDist = dist
      }
    }
  })
  return best
}

/**
 * The RAW (unrounded, unfloored) width/height an outer-edge drag would
 * currently produce — the same anchor math `resizePanelEdge()` commits
 * with, exposed separately so the drawing can check it against OTHER
 * panels' sizes mid-drag (`matchedPanelSize()`) before anything is
 * actually applied to the model.
 */
export function prospectivePanelSize(target: PanelPlacement, side: PanelSide, positionMm: number): number {
  if (side === 'left' || side === 'right') {
    const fixedX = side === 'right' ? target.xMm : target.xMm + target.widthMm
    return side === 'right' ? positionMm - fixedX : fixedX - positionMm
  }
  const fixedY = side === 'bottom' ? target.yMm : target.yMm + target.heightMm
  return side === 'bottom' ? positionMm - fixedY : fixedY - positionMm
}

/** Inverse of `prospectivePanelSize()` — the absolute position that
 * would produce exactly `sizeMm`, for snapping the drag onto a matched
 * size (`matchedPanelSize()`'s result) rather than the raw pointer. */
export function positionFromPanelSize(target: PanelPlacement, side: PanelSide, sizeMm: number): number {
  if (side === 'right') return target.xMm + sizeMm
  if (side === 'left') return target.xMm + target.widthMm - sizeMm
  if (side === 'bottom') return target.yMm + sizeMm
  return target.yMm + target.heightMm - sizeMm // 'top'
}

/**
 * The nearest OTHER panel's width (or height) within `toleranceMm` of
 * `rawSize` — Mario: "try snaping to match hight or width again," this
 * time comparing the panel's own resulting SIZE against every other
 * panel's size, regardless of where that panel sits (unlike
 * `alignedEdgeMm`, which compares EDGE COORDINATES and only ever
 * matters between panels that could plausibly line up). `null` when
 * nothing is close enough.
 */
export function matchedPanelSize<T extends PanelPlacement>(
  panels: T[],
  excludeIndex: number,
  dimension: 'width' | 'height',
  rawSize: number,
  toleranceMm: number,
): number | null {
  let best: number | null = null
  let bestDist = Infinity
  panels.forEach((panel, i) => {
    if (i === excludeIndex) return
    const value = dimension === 'width' ? panel.widthMm : panel.heightMm
    const dist = Math.abs(value - rawSize)
    if (dist <= toleranceMm && dist < bestDist) {
      best = value
      bestDist = dist
    }
  })
  return best
}

/**
 * `resizePanel()` generalized from "set the total width/height" to
 * "the edge under the pointer is now at this ABSOLUTE assembly-space
 * coordinate" — what an outer-edge DRAG naturally produces, and what
 * lets each of the four sides anchor on the edge the user did NOT grab,
 * matching direct-manipulation convention (drag the right edge, the
 * left edge stays put; drag the left edge, the right edge stays put),
 * rather than `resizePanel()`'s own fixed left/bottom anchor. 'right'
 * and 'top' reduce to exactly `resizePanel()`'s existing math (kept
 * as a separate function rather than folded in, since the numeric
 * side-panel fields have no "which edge" to generalize from and
 * `resizePanel()`'s own left/bottom-anchor doc comment is still the
 * right explanation for THEM); 'left' and 'bottom' are the mirror,
 * anchoring the opposite corner and pushing `panelsPushedLeft()`/
 * `panelsPushedDown()`'s sets instead.
 *
 * `positionMm` is clamped so the resulting size never drops below
 * `MIN_GLAZED_PITCH_MM` — a drag has no text field to reject through,
 * same reasoning `moveDivider()`'s own floor documents.
 */
export function resizePanelEdge<T extends PanelPlacement>(panels: T[], index: number, side: PanelSide, positionMm: number): T[] {
  const target = panels[index]
  if (!target) return panels

  if (side === 'left' || side === 'right') {
    const fixedX = side === 'right' ? target.xMm : target.xMm + target.widthMm
    const rawWidth = side === 'right' ? positionMm - fixedX : fixedX - positionMm
    const nextWidth = Math.max(Math.round(rawWidth), MIN_GLAZED_PITCH_MM)
    if (nextWidth === target.widthMm) return panels
    const dW = Number.isFinite(target.widthMm) ? nextWidth - target.widthMm : 0
    const pushed = side === 'right' ? panelsPushedRight(panels, index, target) : panelsPushedLeft(panels, index, target)
    const resized = panels.map((panel, i) => {
      if (i === index) {
        return side === 'right' ? { ...panel, widthMm: nextWidth } : { ...panel, xMm: panel.xMm - dW, widthMm: nextWidth }
      }
      if (!pushed.has(i)) return panel
      return { ...panel, xMm: panel.xMm + (side === 'right' ? dW : -dW) }
    })
    return normalizeOrigin(resized)
  }

  const fixedY = side === 'bottom' ? target.yMm : target.yMm + target.heightMm
  const rawHeight = side === 'bottom' ? positionMm - fixedY : fixedY - positionMm
  const nextHeight = Math.max(Math.round(rawHeight), MIN_GLAZED_PITCH_MM)
  if (nextHeight === target.heightMm) return panels
  const dH = Number.isFinite(target.heightMm) ? nextHeight - target.heightMm : 0
  const pushed = side === 'top' ? panelsPushedUp(panels, index, target) : panelsPushedDown(panels, index, target)
  const resized = panels.map((panel, i) => {
    if (i === index) {
      return side === 'top' ? { ...panel, yMm: panel.yMm - dH, heightMm: nextHeight } : { ...panel, heightMm: nextHeight }
    }
    if (!pushed.has(i)) return panel
    return { ...panel, yMm: panel.yMm + (side === 'top' ? -dH : dH) }
  })
  return normalizeOrigin(resized)
}

/**
 * Removes a panel and closes the gap it leaves — never just deletes it
 * and hopes the rest was already touching. Same bottom-left anchor as
 * `resizePanel()`: whatever was resting ABOVE the removed panel falls by
 * its height, and whatever sat to its RIGHT slides left by its width.
 * Panels below or to the left already rest on a floor that didn't move,
 * so they're left alone.
 *
 * Reuses `panelsPushedRight()`/`panelsPushedUp()` unchanged — a removal
 * is just a resize to zero, run once per axis with the removed panel's
 * own edges as the moved line, so it gets the exact same bridging
 * safety check for free: a panel resting on the removed one AND on some
 * other, untouched panel along that same line (a header spanning three
 * columns, say, when only the middle one is deleted) is excluded from
 * BOTH sets and simply stays put, instead of getting dragged down by
 * the removed panel's full height into whatever's still standing there.
 * A panel touching the removed one on BOTH axes (above AND to its
 * right) only ever qualifies for one of the two sets in practice: a
 * panel sharing the removed panel's vertical span (to fall) and one
 * sharing its horizontal span (to slide) can't be the same rectangle
 * without overlapping it.
 *
 * Still refuses (returns `null`) if the collapse leaves anything
 * disconnected or overlapping — a shape no straightforward slide can
 * fix (e.g. a full 2D grid missing an interior cell) is reported back
 * as "can't remove this" rather than saved as a broken assembly.
 */
export function removePanel<T extends PanelPlacement>(panels: T[], index: number): T[] | null {
  if (panels.length <= 1 || !panels[index]) return null
  const removed = panels[index]

  const slideLeft = panelsPushedRight(panels, index, removed)
  const fallDown = panelsPushedUp(panels, index, removed)

  const collapsed = panels
    .map((panel, i) => {
      if (i === index) return panel
      let next = panel
      if (slideLeft.has(i)) next = { ...next, xMm: next.xMm - removed.widthMm }
      if (fallDown.has(i)) next = { ...next, yMm: next.yMm + removed.heightMm }
      return next
    })
    .filter((_, i) => i !== index)

  if (collapsed.some((a, i) => collapsed.some((b, j) => j > i && panelsOverlap(a, b)))) return null
  if (!panelsConnected(collapsed)) return null
  return normalizeOrigin(collapsed)
}

// ---- Grid editing (docs/sections_planing.md §3) -----------------------
//
// Pure, next to resizePanel: nothing here knows about profiles, glass,
// or the API. `S` is whatever richer section shape a caller actually
// has (sash/glass/opening-type refs and all) — these functions only
// ever touch `row`/`col`, so this file stays free of `@repo/types/
// windows`-shaped concerns, matching `resizePanel`'s own posture of not
// knowing what a panel is FOR.

export interface GridSection {
  row: number
  col: number
}

export interface GridPanelLike<S extends GridSection> extends PanelPlacement {
  columnWidths: number[]
  rowHeights: number[]
  /** Row-major, one entry per cell — same convention `buildWindowLayout`
   * expects, though these helpers only ever read `row`/`col` off it. */
  sections: S[]
}

/**
 * Adds a row of `heightMm` to `panel`'s grid — "+ → Transom" on the
 * word 'top'/'bottom' (decision 2): grows the SAME panel and inserts a
 * full-width divider, rather than coupling a second frame beside it.
 * `makeSection(row, col)` builds each new cell; a caller normally clones
 * an existing section's glass into a FIXED one ("Cloning the source
 * panel's glass for the new sections" — decision 2's own wording), but
 * this file has no opinion on what a section actually contains.
 *
 * `at: 'top'` inserts at local row 0 and shifts every existing section's
 * `row` up by one; `'bottom'` appends past the last existing row, so
 * nothing shifts. Either way, `resizePanel` is what actually moves the
 * panel and its coupled neighbours — its BOTTOM-anchored height rule
 * (see that function's own comment) is what makes 'top' visually grow
 * upward and 'bottom' grow downward; this function only ever changes
 * WHICH end of the local row array the new row occupies, since a row's
 * OWN render position is always relative to the panel's current top
 * edge, never to the assembly.
 */
export function insertRow<T extends GridPanelLike<S>, S extends GridSection>(
  panels: T[],
  index: number,
  at: 'top' | 'bottom',
  heightMm: number,
  makeSection: (row: number, col: number) => S,
): T[] {
  const panel = panels[index]
  if (!panel) return panels
  const cols = panel.columnWidths.length
  const insertedRow = at === 'top' ? 0 : panel.rowHeights.length
  const pitch = Math.max(Math.round(heightMm), 1)

  const rowHeights = [...panel.rowHeights]
  rowHeights.splice(insertedRow, 0, pitch)

  const shifted = panel.sections.map((s) => (s.row >= insertedRow ? { ...s, row: s.row + 1 } : s))
  const added: S[] = []
  for (let col = 0; col < cols; col++) added.push(makeSection(insertedRow, col))

  // `buildWindowLayout` reads a section by ARRAY POSITION
  // (`sections[row * cols + col]`), not by searching its `row`/`col`
  // fields — so the array itself has to stay row-major-ordered after
  // every edit, not just internally consistent. Appending `added` after
  // `shifted` is correct for `at: 'bottom'` (the new row IS the last
  // one), but wrong for `at: 'top'`: the new row's sections belong at
  // the FRONT of the array, not the back. Sorting by (row, col) after
  // combining is simpler and more robust than computing the splice
  // position by hand, and is correct for both sides.
  const sections = [...shifted, ...added].sort((a, b) => a.row - b.row || a.col - b.col)

  const updated: T = { ...panel, rowHeights, sections }
  const withUpdated = panels.map((p, i) => (i === index ? updated : p))
  return resizePanel(withUpdated, index, updated.widthMm, panel.heightMm + pitch)
}

/** Mirror of `insertRow` for a column — `at: 'left'` inserts at local
 * col 0 (shifting every existing section's `col` right by one), `at:
 * 'right'` appends past the last existing column. */
export function insertColumn<T extends GridPanelLike<S>, S extends GridSection>(
  panels: T[],
  index: number,
  at: 'left' | 'right',
  widthMm: number,
  makeSection: (row: number, col: number) => S,
): T[] {
  const panel = panels[index]
  if (!panel) return panels
  const rows = panel.rowHeights.length
  const insertedCol = at === 'left' ? 0 : panel.columnWidths.length
  const pitch = Math.max(Math.round(widthMm), 1)

  const columnWidths = [...panel.columnWidths]
  columnWidths.splice(insertedCol, 0, pitch)

  const shifted = panel.sections.map((s) => (s.col >= insertedCol ? { ...s, col: s.col + 1 } : s))
  const added: S[] = []
  for (let row = 0; row < rows; row++) added.push(makeSection(row, insertedCol))

  // Same row-major re-sort as `insertRow` above, for the same reason —
  // a new LEFT column's sections need to be interleaved into every
  // row's own slice of the array, not appended after all of them.
  const sections = [...shifted, ...added].sort((a, b) => a.row - b.row || a.col - b.col)

  const updated: T = { ...panel, columnWidths, sections }
  const withUpdated = panels.map((p, i) => (i === index ? updated : p))
  return resizePanel(withUpdated, index, panel.widthMm + pitch, updated.heightMm)
}

/**
 * Removes the divider at boundary `k` (1-based, matching the `div-h{k}`/
 * `div-v{k}` part id), merging the two rows/columns it separated. The
 * merged pitch is the SUM of the two — "shrink nothing" — so the
 * panel's own `widthMm`/`heightMm` are unaffected and no coupled
 * neighbour needs to move. The surviving cell keeps the FIRST (lower
 * row/col index) section's fields; the second's section is dropped.
 */
export function removeDivider<T extends GridPanelLike<S>, S extends GridSection>(
  panels: T[],
  index: number,
  orientation: 'horizontal' | 'vertical',
  k: number,
): T[] {
  const panel = panels[index]
  if (!panel) return panels

  if (orientation === 'horizontal') {
    const rowHeights = [...panel.rowHeights]
    if (k < 1 || k >= rowHeights.length) return panels
    rowHeights[k - 1] += rowHeights[k]
    rowHeights.splice(k, 1)
    const sections = panel.sections.filter((s) => s.row !== k).map((s) => (s.row > k ? { ...s, row: s.row - 1 } : s))
    const updated: T = { ...panel, rowHeights, sections }
    return panels.map((p, i) => (i === index ? updated : p))
  }

  const columnWidths = [...panel.columnWidths]
  if (k < 1 || k >= columnWidths.length) return panels
  columnWidths[k - 1] += columnWidths[k]
  columnWidths.splice(k, 1)
  const sections = panel.sections.filter((s) => s.col !== k).map((s) => (s.col > k ? { ...s, col: s.col - 1 } : s))
  const updated: T = { ...panel, columnWidths, sections }
  return panels.map((p, i) => (i === index ? updated : p))
}

/**
 * Changes one grid cell's own width/height — the section itself never
 * steals from a neighbour section (docs/sections_planing.md's own
 * assumption): the PANEL grows or shrinks by the same delta instead,
 * exactly `resizePanel`'s rule (width left-anchored, height
 * bottom-anchored), pushing coupled panels along with it.
 */
export function resizeSection<T extends GridPanelLike<S>, S extends GridSection>(
  panels: T[],
  index: number,
  row: number,
  col: number,
  widthMm: number,
  heightMm: number,
): T[] {
  const panel = panels[index]
  if (!panel) return panels
  const columnWidths = [...panel.columnWidths]
  const rowHeights = [...panel.rowHeights]
  const nextColWidth = Math.max(Math.round(widthMm), 1)
  const nextRowHeight = Math.max(Math.round(heightMm), 1)
  const dW = nextColWidth - columnWidths[col]
  const dH = nextRowHeight - rowHeights[row]
  columnWidths[col] = nextColWidth
  rowHeights[row] = nextRowHeight

  const updated: T = { ...panel, columnWidths, rowHeights }
  const withUpdated = panels.map((p, i) => (i === index ? updated : p))
  return resizePanel(withUpdated, index, panel.widthMm + dW, panel.heightMm + dH)
}

/**
 * `resizeSection()`'s own logic generalized the same way `resizePanel()`
 * became `resizePanelEdge()` above — an outer-edge DRAG on a GRIDDED
 * panel routes the delta to whichever column/row sits nearest the
 * dragged edge (right → last column, left → first column, top → first
 * row, bottom → last row; the STATUS/planing doc's own "gives the
 * delta to the column/row nearest the moving edge" default, which the
 * numeric-field path above already matched for its two supported
 * directions by construction). Same "update the one cell, then let the
 * panel-level function do the anchor-correct total resize + neighbour
 * push" shape as `resizeSection()`, just calling `resizePanelEdge()`
 * instead of `resizePanel()` so all four sides get the right anchor.
 */
export function resizeSectionEdge<T extends GridPanelLike<S>, S extends GridSection>(
  panels: T[],
  index: number,
  side: PanelSide,
  positionMm: number,
): T[] {
  const panel = panels[index]
  if (!panel) return panels
  const columnWidths = [...panel.columnWidths]
  const rowHeights = [...panel.rowHeights]
  let resolvedPositionMm: number

  if (side === 'left' || side === 'right') {
    const cell = side === 'right' ? columnWidths.length - 1 : 0
    const fixedX = side === 'right' ? panel.xMm : panel.xMm + panel.widthMm
    const rawWidth = side === 'right' ? positionMm - fixedX : fixedX - positionMm
    // Floored at whichever is more restrictive: `resizePanelEdge`'s own
    // panel-total floor, or the width that would leave THIS column at
    // exactly 1mm with every other column untouched. Reusing that same
    // resolved width to derive the position handed to `resizePanelEdge`
    // below (rather than the raw, unfloored `positionMm`) is what keeps
    // `columnWidths` summing to the panel's own `widthMm` — the model's
    // grid-sum invariant — even at the extreme end of a drag, instead of
    // the two floors silently disagreeing.
    const minWidth = Math.max(MIN_GLAZED_PITCH_MM, panel.widthMm - columnWidths[cell] + 1)
    const nextWidth = Math.max(Math.round(rawWidth), minWidth)
    columnWidths[cell] += nextWidth - panel.widthMm
    resolvedPositionMm = side === 'right' ? fixedX + nextWidth : fixedX - nextWidth
  } else {
    const cell = side === 'top' ? 0 : rowHeights.length - 1
    const fixedY = side === 'bottom' ? panel.yMm : panel.yMm + panel.heightMm
    const rawHeight = side === 'bottom' ? positionMm - fixedY : fixedY - positionMm
    const minHeight = Math.max(MIN_GLAZED_PITCH_MM, panel.heightMm - rowHeights[cell] + 1)
    const nextHeight = Math.max(Math.round(rawHeight), minHeight)
    rowHeights[cell] += nextHeight - panel.heightMm
    resolvedPositionMm = side === 'bottom' ? fixedY + nextHeight : fixedY - nextHeight
  }

  const updated: T = { ...panel, columnWidths, rowHeights }
  const withUpdated = panels.map((p, i) => (i === index ? updated : p))
  return resizePanelEdge(withUpdated, index, side, resolvedPositionMm)
}

/** The real "too narrow to glaze" limit — `window-weight.ts`'s own V2
 * rule (`sectionTooSmall`) rejects any column/row pitch under this as a
 * hard error. Shared here so every LIVE drag that can shrink a pitch
 * (`moveDivider`, and `resizePanelEdge`/`resizeSectionEdge`'s own floor
 * for a plain single-section panel, which IS its one column/row) clamps
 * at the same value instead of letting the drag go past it and only
 * then surfacing a validation error (Mario, 2026-09-16: "please block
 * the user from draging more dont just show an error" — raised from an
 * earlier, unrelated 100mm drag-usability floor to this actual number
 * specifically so the two can never disagree). A drag has no text field
 * to show a validation error in anyway, so it clamps instead of
 * rejecting, same reasoning as before. */
export const MIN_GLAZED_PITCH_MM = 200

/**
 * Moves divider `k` (the boundary between column/row `k-1` and `k`,
 * same 1-based convention `removeDivider` uses) to an ABSOLUTE
 * panel-local position along that axis — `boundaryMm` is measured from
 * the panel's own top/left edge, i.e. the same coordinate space
 * `cumulativeBoundaries(columnWidths/rowHeights)` already uses.
 *
 * Unlike `resizeSection` (which grows the PANEL and leaves every other
 * section's own pitch untouched — decision for the side panel's numeric
 * fields), dragging the divider itself REDISTRIBUTES between exactly
 * the two sections it separates: one grows by what the other shrinks,
 * so `columnWidths[k-1] + columnWidths[k]` (or the row equivalent) is
 * invariant across the whole drag and the panel's own width/height,
 * every other pitch, and every coupled neighbour are all left alone —
 * a mullion/transom drag never ripples outside the two cells it
 * touches (Mario, 2026-09-15, chosen over the grow-the-panel rule when
 * asked which one dragging should follow).
 *
 * Because the pair's sum never changes, this is safe to call fresh on
 * every pointer-move with the CURRENT `panels` (not a drag-start
 * snapshot) — `boundaries[k-1]`/`boundaries[k+1]` (the two OUTER edges
 * of the pair) are the same on every call, so there's nothing for a
 * naive re-application to double-count.
 */
export function moveDivider<T extends GridPanelLike<S>, S extends GridSection>(
  panels: T[],
  index: number,
  orientation: 'horizontal' | 'vertical',
  k: number,
  boundaryMm: number,
  minMm: number = MIN_GLAZED_PITCH_MM,
): T[] {
  const panel = panels[index]
  if (!panel) return panels
  const pitches = orientation === 'vertical' ? panel.columnWidths : panel.rowHeights
  if (k < 1 || k >= pitches.length) return panels

  const boundaries = cumulativeBoundaries(pitches)
  const outerLo = boundaries[k - 1]
  const outerHi = boundaries[k + 1]
  // A degenerate pair (already thinner than 2×minMm combined, e.g. old
  // data from before this floor existed) has no room to satisfy the
  // floor on both sides — split it evenly rather than producing an
  // inverted [lo, hi] clamp range.
  const mid = (outerLo + outerHi) / 2
  const lo = Math.min(outerLo + minMm, mid)
  const hi = Math.max(outerHi - minMm, mid)
  const nextBoundary = Math.round(Math.min(Math.max(boundaryMm, lo), hi))

  const nextPitches = [...pitches]
  nextPitches[k - 1] = nextBoundary - outerLo
  nextPitches[k] = outerHi - nextBoundary

  const updated: T = orientation === 'vertical' ? { ...panel, columnWidths: nextPitches } : { ...panel, rowHeights: nextPitches }
  return panels.map((p, i) => (i === index ? updated : p))
}

/** Shifts the whole assembly so its bounding box starts at (0,0). The
 * API does the same on write, so this keeps the client's own model
 * identical to what a round trip would return. */
export function normalizeOrigin<T extends PanelPlacement>(panels: T[]): T[] {
  if (panels.length === 0) return panels
  const minX = Math.min(...panels.map((p) => p.xMm))
  const minY = Math.min(...panels.map((p) => p.yMm))
  if (minX === 0 && minY === 0) return panels
  return panels.map((p) => ({ ...p, xMm: p.xMm - minX, yMm: p.yMm - minY }))
}

function hasDividerAt(panel: GridPanelLike<GridSection>, position: number, axis: 'x' | 'y'): boolean {
  const pitches = axis === 'x' ? panel.columnWidths : panel.rowHeights
  const origin = axis === 'x' ? panel.xMm : panel.yMm
  let cumulative = origin
  for (let i = 0; i < pitches.length - 1; i++) {
    cumulative += pitches[i]
    if (cumulative === position) return true
  }
  return false
}

/**
 * V9 `dividerMisaligned` (docs/sections_planing.md §6): a mullion only
 * needs to line up across a panel stacked above/below it (its own
 * boundary is a vertical line, meaningless to a panel beside it); a
 * transom only needs to line up across a panel beside it. Pure
 * geometry — returns each mismatched divider's local part id, matching
 * `buildWindowLayout`'s own `div-v{k}`/`div-h{j}` scheme, for the
 * caller to prefix into an assembly id and turn into a `WindowIssue`.
 *
 * A neighbour that hasn't been divided on the relevant axis at all yet
 * (still a plain 1-wide/1-tall span there) is never a mismatch by
 * itself — Mario, 2026-09-14: don't warn about a brand-new coupled
 * panel until ITS OWN divider actually exists and lands somewhere
 * else. Only a neighbour that already has its own divider on that axis
 * can be "misaligned"; `hasDividerAt` alone can't distinguish those two
 * cases (a still-undivided neighbour and a divided-but-off-position one
 * both have "no divider at this exact x/y").
 */
export function findMisalignedDividers<T extends GridPanelLike<GridSection>>(
  panels: T[],
): { panelIndex: number; localId: string }[] {
  const mismatches: { panelIndex: number; localId: string }[] = []

  panels.forEach((panel, panelIndex) => {
    const cols = panel.columnWidths.length
    const rows = panel.rowHeights.length

    if (cols > 1) {
      const stackedNeighbours = panels.filter(
        (other, j) => j !== panelIndex && other.columnWidths.length > 1 && (touchesTopEdge(panel, other) || touchesTopEdge(other, panel)),
      )
      let x = panel.xMm
      for (let k = 1; k < cols; k++) {
        x += panel.columnWidths[k - 1]
        const aligned = stackedNeighbours.every(
          (n) => x <= n.xMm || x >= n.xMm + n.widthMm || hasDividerAt(n, x, 'x'),
        )
        if (!aligned) mismatches.push({ panelIndex, localId: `div-v${k}` })
      }
    }

    if (rows > 1) {
      const sideNeighbours = panels.filter(
        (other, j) =>
          j !== panelIndex &&
          other.rowHeights.length > 1 &&
          panelsTouch(panel, other) &&
          !touchesTopEdge(panel, other) &&
          !touchesTopEdge(other, panel),
      )
      let y = panel.yMm
      for (let j = 1; j < rows; j++) {
        y += panel.rowHeights[j - 1]
        const aligned = sideNeighbours.every(
          (n) => y <= n.yMm || y >= n.yMm + n.heightMm || hasDividerAt(n, y, 'y'),
        )
        if (!aligned) mismatches.push({ panelIndex, localId: `div-h${j}` })
      }
    }
  })

  return mismatches
}

function offsetRect(rect: RectMm, dx: number, dy: number): RectMm {
  return { ...rect, x: rect.x + dx, y: rect.y + dy }
}
