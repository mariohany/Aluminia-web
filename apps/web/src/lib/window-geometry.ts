import { SystemType } from '@repo/types/lookups'
import { HingedOpeningType, HeadShape, SectionKind } from '@repo/types/windows'
import type { SlidingLayoutInput, SlidingOpeningType } from '@repo/types/sliding'
import { insetHeadOutline, normalizeHeadRise, type HeadOutline } from '@/lib/arch-geometry'
import { samplePath, type Seg } from '@/lib/curves'
import { frameGeometry, resolveDividers, type DividerLike, type MemberAxis } from '@/lib/dividers'
import { buildLightGraph, insetLoop } from '@/lib/light-graph'
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
  /** Which section (light) this part belongs to — an index into the
   * panel's `sections`, which are kept one per light in display order
   * (docs/free_dividers_planing.md §4.2). `null` for a panel-level part
   * (`frame`, `divider`). */
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
  /** A divider's own outline: its face width along its centreline, each
   * end cut against what it lands on (light-graph.ts bands). Set on
   * every `divider` part; `rectMm` is its bounding box. */
  band?: Seg[]
  /** A shaped arch light's glass (docs/free_dividers_planing.md §4.3) —
   * neither a rectangle nor the whole-arch outline. `rectMm` is its
   * bounding box. */
  outline?: Seg[]
  /** With `outline`: the light's clear opening, which the bead fills
   * down to the glass. */
  clearOutline?: Seg[]
  /** On a `divider` part: its id in the panel's `dividers`, and whether
   * it is a straight vertical (`v`, a mullion), a straight horizontal
   * (`h`) or anything else (`null`, slanted or curved). */
  dividerId?: string
  dividerAxis?: MemberAxis
  /** On a `divider` part: its cut length (light-graph.ts band). */
  cutLengthMm?: number
}

/** One grid cell's worth of layout input — everything `buildWindowLayout`
 * needs to decide how a section draws, independent of what it's actually
 * glazed with (that's `useResolvedPanels`' job, not this file's). */
export interface WindowSectionLayoutInput {
  /** Which light this is (docs/free_dividers_planing.md §4.2). */
  faceKey: string
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
  /** The panel's dividers, ends anchored on the frame or each other
   * (docs/free_dividers_planing.md §1). */
  dividers: readonly DividerLike[]
  /** A divider's face width — its own profile's, else the panel
   * default's (Q12). Defaults to `metrics.dividerFace` for all. */
  dividerFace?: (dividerId: string) => number
  /** One per light, keyed by `faceKey`; a light with no section isn't
   * glazed (callers align them first — panel-lights.ts). */
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
 * Whether a panel can take an arched head at all. Sliding never can (its
 * leaves run on straight tracks) and neither can a hinged door (its
 * no-sill inset has no arch-aware form — the arched-door reference photos
 * are two coupled panels). Dividers no longer matter: a mullion may rise
 * into the arch (docs/free_dividers_planing.md's assumptions), and only
 * the whole-arch light itself can carry an arched sash.
 */
export function canHaveArchedHead(input: Pick<WindowLayoutInput, 'isDoor' | 'systemType'>): boolean {
  const isDoorHinged = input.isDoor && input.systemType === SystemType.HINGED
  return !isDoorHinged && input.systemType !== SystemType.SLIDING
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

function boundsOf(segs: Seg[]): RectMm {
  const points = samplePath(segs)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(Math.max(...xs) - x, 1), height: Math.max(Math.max(...ys) - y, 1) }
}

/**
 * One panel's parts: the frame, one `divider` part per divider (its band,
 * cut at both ends), and each light's sash/glass/fly screen — a
 * rectangular light exactly as a section always drew, the whole-arch
 * light with today's arched sash/glass, any other arch light as fixed
 * shaped glass (docs/free_dividers_planing.md §5.1).
 */
export function buildWindowLayout(input: WindowLayoutInput): WindowLayout {
  const width = Math.max(input.widthMm, 1)
  const height = Math.max(input.heightMm, 1)
  const { metrics } = input

  const isDoorHinged = input.isDoor && input.systemType === SystemType.HINGED
  const headShape = input.headShape ?? HeadShape.FLAT
  const archable = headShape !== HeadShape.FLAT && canHaveArchedHead({ isDoor: input.isDoor, systemType: input.systemType })
  const shape = archable ? headShape : HeadShape.FLAT
  const riseMm = archable ? normalizeHeadRise(headShape, width, input.headRiseMm ?? 0, height) : 0

  const geo = frameGeometry({ widthMm: width, heightMm: height, headShape: shape, headRiseMm: riseMm, frameFace: metrics.frameFace, doorSill: isDoorHinged, springOffsetMm: metrics.dividerFace / 2 })
  const faceOf = input.dividerFace ?? (() => metrics.dividerFace)
  const graph = buildLightGraph(geo, input.dividers, (id) => faceOf(id) / 2)
  const resolved = resolveDividers(geo, input.dividers)

  const parts: WindowPart[] = [
    {
      id: 'frame',
      kind: 'frame',
      index: 0,
      panelIndex: 0,
      sectionIndex: null,
      rectMm: { x: 0, y: 0, width, height },
      head: archable ? { shape, riseMm } : undefined,
    },
  ]

  graph.bands.forEach((band, i) => {
    parts.push({
      id: `div-${band.dividerId}`,
      kind: 'divider',
      index: i,
      panelIndex: 0,
      sectionIndex: null,
      rectMm: boundsOf(band.outline),
      band: band.outline,
      dividerId: band.dividerId,
      dividerAxis: resolved.get(band.dividerId)?.axis ?? null,
      cutLengthMm: band.lengthMm,
    })
  })

  for (const light of graph.lights) {
    const sectionIndex = input.sections.findIndex((s) => s.faceKey === light.key)
    const section = input.sections[sectionIndex]
    if (!section) continue
    const skipBottomInset = isDoorHinged && light.members.includes('sill')
    if (light.rect) {
      buildSectionParts(parts, section, sectionIndex, light.rect, null, metrics, input.flyScreenAllowed, input.systemType, skipBottomInset, section.sliding ?? null)
    } else if (light.head) {
      // The whole-arch light keeps today's arched sash — unless its
      // opening type needs two leaves or a mullion bar, which have no
      // arched form: those draw on the light's bounding rectangle.
      const multiLeaf =
        !!section.openingType &&
        (DOUBLE_DOOR_OPENING_TYPES.includes(section.openingType) ||
          section.openingType === HingedOpeningType.FIXED_VERTICAL_MULLION ||
          section.openingType === HingedOpeningType.FIXED_HORIZONTAL_MULLION)
      buildSectionParts(parts, section, sectionIndex, light.head.rect, multiLeaf ? null : light.head, metrics, input.flyScreenAllowed, input.systemType, skipBottomInset, section.sliding ?? null)
    } else if (light.clear) {
      const glass = insetLoop(light.clear, () => metrics.beadFace)
      if (glass) parts.push({ id: `s${sectionIndex}:glass-0-0`, kind: 'glass', index: 0, panelIndex: 0, sectionIndex, rectMm: boundsOf(glass), outline: glass, clearOutline: light.clear })
    }
  }

  return { outerMm: { width, height }, parts }
}

/** One light's sash/glass/flyScreen parts — the per-panel branching
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
        band: part.band && offsetSegs(part.band, panel.xMm, panel.yMm),
        outline: part.outline && offsetSegs(part.outline, panel.xMm, panel.yMm),
        clearOutline: part.clearOutline && offsetSegs(part.clearOutline, panel.xMm, panel.yMm),
      })
    }
  })

  const outer = unionRect(panelRects)
  // Width/height, not the union's x/y — a normalised assembly starts at
  // (0,0), and the drawing's viewBox is built from the size alone.
  return { outerMm: { width: outer.width, height: outer.height }, parts, panelRects }
}

/**
 * What the UI calls each divider of one panel's parts — "Mullion N" for a
 * straight vertical, "Transom N" for everything else (every arch member
 * is a transom — docs/free_dividers_planing.md vocabulary). Numbered
 * left to right for mullions, top to bottom then left to right for
 * transoms, so the numbers read the way the drawing does.
 */
export function dividerNames(parts: WindowPart[]): Map<string, { kind: 'mullion' | 'transom'; number: number }> {
  const dividers = parts.filter((p) => p.kind === 'divider')
  const centre = (p: WindowPart) => ({ x: p.rectMm.x + p.rectMm.width / 2, y: p.rectMm.y + p.rectMm.height / 2 })
  const mullions = dividers.filter((p) => p.dividerAxis === 'v').sort((a, b) => centre(a).x - centre(b).x || centre(a).y - centre(b).y)
  const transoms = dividers.filter((p) => p.dividerAxis !== 'v').sort((a, b) => centre(a).y - centre(b).y || centre(a).x - centre(b).x)
  const out = new Map<string, { kind: 'mullion' | 'transom'; number: number }>()
  mullions.forEach((p, i) => out.set(p.id, { kind: 'mullion', number: i + 1 }))
  transoms.forEach((p, i) => out.set(p.id, { kind: 'transom', number: i + 1 }))
  return out
}

/** `"p1:s0:sash-0"` → `{ panelIndex: 1, localId: "s0:sash-0", sectionIndex:
 * 0 }`; `"p1:div-m1"` → `sectionIndex: null` (a panel-level part belongs
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
 * side's leading edge (left for top/bottom, top for left/right). Like
 * every edit below, the result stays in the INCOMING frame — the caller
 * re-normalises (see `normalizeOrigin`).
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
  return [...panels, placed]
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

  return resized
}

/**
 * The nearest OTHER panel's mullion (`orientation: 'vertical'`, compared
 * along x) or transom (`'horizontal'`, along y) within `toleranceMm` of
 * `positionMm`, as an assembly-space coordinate — or `null`. Reads the
 * divider parts `buildAssemblyLayout` already placed (their rect centre
 * is the boundary itself), so it needs no grid data of its own. Mario,
 * 2026-10-02: a dragged mullion/transom snaps onto any other panel's in
 * the same window, same pull as the edge drag's size snap; dividers in
 * the SAME panel and plain panel edges deliberately don't count.
 */
export function nearestDividerMm(
  parts: WindowPart[],
  excludePanelIndex: number,
  orientation: 'horizontal' | 'vertical',
  positionMm: number,
  toleranceMm: number,
): number | null {
  const axis = orientation === 'vertical' ? 'v' : 'h'
  let best: number | null = null
  for (const part of parts) {
    if (part.kind !== 'divider' || part.panelIndex === excludePanelIndex) continue
    if (part.dividerAxis !== axis) continue
    const centre = orientation === 'vertical' ? part.rectMm.x + part.rectMm.width / 2 : part.rectMm.y + part.rectMm.height / 2
    const distance = Math.abs(centre - positionMm)
    if (distance <= toleranceMm && (best === null || distance < Math.abs(best - positionMm))) best = centre
  }
  return best
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
    return resized
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
  return resized
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
  return collapsed
}

/** The real "too narrow to glaze" limit — `window-weight.ts`'s own V2
 * rule (`sectionTooSmall`) rejects any light pitch under this as a
 * hard error. Shared here so every LIVE drag that can shrink a pitch
 * (a divider drag, and `resizePanelEdge`'s own floor) clamps
 * at the same value instead of letting the drag go past it and only
 * then surfacing a validation error (Mario, 2026-09-16: "please block
 * the user from draging more dont just show an error" — raised from an
 * earlier, unrelated 100mm drag-usability floor to this actual number
 * specifically so the two can never disagree). A drag has no text field
 * to show a validation error in anyway, so it clamps instead of
 * rejecting, same reasoning as before. */
export const MIN_GLAZED_PITCH_MM = 200

/** How far `normalizeOrigin` is about to shift `panels` — the bounding
 * box's own top-left corner.
 *
 * The edit functions above (`insertPanel`, `resizePanel`,
 * `resizePanelEdge`, `removePanel` and everything built on them) do NOT
 * normalise themselves — they return positions in the frame they were
 * given, which may run negative after growing up/left. The editor
 * normalises in one place and reads this off the raw result first: the
 * drawing's camera is fixed once the editor opens, so it has to move by
 * that same shift or the whole elevation would visibly jump down/right
 * every time something grew up/left (and a dragged left/top edge would
 * slide out from under the pointer). */
export function originShiftMm(panels: PanelPlacement[]): { x: number; y: number } {
  if (panels.length === 0) return { x: 0, y: 0 }
  return { x: Math.min(...panels.map((p) => p.xMm)), y: Math.min(...panels.map((p) => p.yMm)) }
}

/** Shifts the whole assembly so its bounding box starts at (0,0). The
 * API does the same on write, so this keeps the client's own model
 * identical to what a round trip would return. See `originShiftMm`. */
export function normalizeOrigin<T extends PanelPlacement>(panels: T[]): T[] {
  if (panels.length === 0) return panels
  const minX = Math.min(...panels.map((p) => p.xMm))
  const minY = Math.min(...panels.map((p) => p.yMm))
  if (minX === 0 && minY === 0) return panels
  return panels.map((p) => ({ ...p, xMm: p.xMm - minX, yMm: p.yMm - minY }))
}

/** Every straight mullion (x) or transom (y) of panel `panelIndex`, as
 * an assembly-space position with its local part id, from the laid-out
 * parts (a divider part's rect centre is its centreline). */
function dividerPositions(parts: WindowPart[], panelIndex: number, axis: 'x' | 'y'): { p: number; localId: string }[] {
  return parts
    .filter((part) => part.panelIndex === panelIndex && part.kind === 'divider' && part.dividerAxis === (axis === 'x' ? 'v' : 'h'))
    .map((part) => ({
      p: axis === 'x' ? part.rectMm.x + part.rectMm.width / 2 : part.rectMm.y + part.rectMm.height / 2,
      localId: part.id.slice(part.id.indexOf(':') + 1),
    }))
    .sort((a, b) => a.p - b.p)
}

/**
 * Which of `mine` are paired with one of `theirs` but don't line up.
 * Exact matches pair off first; the rest pair greedily, closest gap
 * first, so the result is the same whichever panel is asking (each
 * side of a clash warns on its own divider). A divider left without a
 * partner — the neighbour simply has fewer — is never a mismatch.
 */
function unpairedMismatches(mine: number[], theirs: number[]): Set<number> {
  const freeMine = new Set(mine.keys())
  const freeTheirs = new Set(theirs.keys())
  for (const i of [...freeMine]) {
    const j = [...freeTheirs].find((t) => theirs[t] === mine[i])
    if (j === undefined) continue
    freeMine.delete(i)
    freeTheirs.delete(j)
  }
  const candidates: { i: number; j: number; gap: number }[] = []
  for (const i of freeMine) for (const j of freeTheirs) candidates.push({ i, j, gap: Math.abs(mine[i] - theirs[j]) })
  candidates.sort((a, b) => a.gap - b.gap || a.i - b.i || a.j - b.j)
  const misaligned = new Set<number>()
  for (const { i, j } of candidates) {
    if (!freeMine.has(i) || !freeTheirs.has(j)) continue
    freeMine.delete(i)
    freeTheirs.delete(j)
    misaligned.add(i)
  }
  return misaligned
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
 * A divider only warns when it has a PARTNER to couple with in that
 * neighbour and misses it. Per neighbour, both sides' dividers within
 * the shared span are paired (exact matches first, then closest gap —
 * `unpairedMismatches`); leftovers on the side with more dividers stay
 * quiet (Mario, 2026-10-02: "dont show warning on transom/mulion if
 * there's no other transom/mulion to couple with"). This also covers
 * the earlier 2026-09-14 rule — a neighbour not yet divided on that
 * axis has nothing to pair with, so a brand-new coupled panel never
 * warns until its own divider exists and lands somewhere else.
 */
export function findMisalignedDividers<T extends PanelPlacement>(panels: T[], parts: WindowPart[]): { panelIndex: number; localId: string }[] {
  const mismatches: { panelIndex: number; localId: string }[] = []

  panels.forEach((panel, panelIndex) => {
    // Mullions (x) against panels stacked above/below; transoms (y)
    // against panels beside it.
    for (const axis of ['x', 'y'] as const) {
      const mine = dividerPositions(parts, panelIndex, axis)
      if (mine.length === 0) continue
      const bad = new Set<number>()
      panels.forEach((other, j) => {
        if (j === panelIndex) return
        const stacked = touchesTopEdge(panel, other) || touchesTopEdge(other, panel)
        if (axis === 'x' ? !stacked : !panelsTouch(panel, other) || stacked) return
        const lo = axis === 'x' ? other.xMm : other.yMm
        const hi = lo + (axis === 'x' ? other.widthMm : other.heightMm)
        const myLo = axis === 'x' ? panel.xMm : panel.yMm
        const myHi = myLo + (axis === 'x' ? panel.widthMm : panel.heightMm)
        // Only dividers inside the span the two panels share can couple.
        const mineInSpan = mine.map((m, k) => ({ ...m, k })).filter(({ p }) => p > lo && p < hi)
        const theirs = dividerPositions(parts, j, axis).map((t) => t.p).filter((p) => p > myLo && p < myHi)
        for (const i of unpairedMismatches(mineInSpan.map(({ p }) => p), theirs)) bad.add(mineInSpan[i].k)
      })
      for (const k of [...bad].sort((a, b) => a - b)) mismatches.push({ panelIndex, localId: mine[k].localId })
    }
  })

  return mismatches
}

function offsetRect(rect: RectMm, dx: number, dy: number): RectMm {
  return { ...rect, x: rect.x + dx, y: rect.y + dy }
}

function offsetSegs(segs: Seg[], dx: number, dy: number): Seg[] {
  return segs.map((seg) =>
    seg.kind === 'line'
      ? { kind: 'line', a: { x: seg.a.x + dx, y: seg.a.y + dy }, b: { x: seg.b.x + dx, y: seg.b.y + dy } }
      : { ...seg, c: { x: seg.c.x + dx, y: seg.c.y + dy } },
  )
}
