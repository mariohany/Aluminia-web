import { SystemType } from '@repo/types/lookups'
import { HingedOpeningType } from '@repo/types/windows'

// Profiles carry no face-width field yet (system_profile has weight,
// perimeter, inertia — not a drawable cross-section width), so the
// elevation is built from these nominal constants instead of real
// profile geometry. Every size derived from them is labelled
// "indicative" in the UI. See docs/window_design_planing.md's
// "Assumptions" and §5 for the future real-geometry task.
// Frame face and glazing bead are the two insets that actually give the
// drawing its visible thickness (window-drawing.tsx fills right out to
// them, no gap) — kept at the same 2.5:1 ratio as before, just scaled up.
export const NOMINAL_FRAME_FACE_MM = 75
export const NOMINAL_SASH_FACE_MM = 60
export const NOMINAL_SLIDING_INTERLOCK_MM = 30
export const NOMINAL_GLAZING_BEAD_MM = 45
// The static bar a fixed_vertical_mullion/fixed_horizontal_mullion
// opening type splits its one light with — a real structural member
// between two independently-glazed lights, not a decorative overlay
// (that's what the Georgian-bar grid is, driven by the glass build-up
// instead of the opening type — a different feature that happens to
// reuse the same bar-drawing code in window-drawing.tsx).
export const NOMINAL_MULLION_BAR_MM = 50

export type WindowPartKind = 'frame' | 'sash' | 'glass' | 'flyScreen'

export interface RectMm {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowPart {
  id: string
  kind: WindowPartKind
  /** Which sash/glass, 0-based. 0 for frame/flyScreen. */
  index: number
  /** Which panel of the assembly this part belongs to — always 0 from
   * `buildWindowLayout()` (one panel's worth), rewritten by
   * `buildAssemblyLayout()`. The part's `id` carries the same number as
   * a `p<n>:` prefix; this is the parsed form, so a caller filtering
   * parts by panel doesn't have to do string work. */
  panelIndex: number
  rectMm: RectMm
}

export interface WindowLayoutInput {
  widthMm: number
  heightMm: number
  systemType: SystemType | null
  hasFlyScreen: boolean
  flyScreenAllowed: boolean
  /** A hinged door has no sill — the opening (and its sash/glass/mesh)
   * runs flush to the frame's actual bottom edge instead of stopping a
   * frame-face short of it. Ignored for every other systemType. */
  isDoor: boolean
  /** Only meaningful for `systemType === 'hinged'` — sliding/curtain_wall
   * ignore it entirely (sliding gets its own icon set later, not this
   * one). Most values are purely decorative (window-drawing.tsx draws a
   * hinge/pivot symbol on the existing single sash+glass, no geometry
   * change); the double-door and fixed-mullion families below are the
   * exception — they actually change how many sashes/lights this
   * function builds. */
  openingType: HingedOpeningType | null
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
 * `systemType` — sliding draws two overlapping leaves, hinged and
 * curtain_wall (and no frame chosen yet) draw one fixed leaf. Nothing
 * here is persisted; it's recomputed from the window's own fields on
 * every render.
 */
export function buildWindowLayout(input: WindowLayoutInput): WindowLayout {
  const width = Math.max(input.widthMm, 1)
  const height = Math.max(input.heightMm, 1)

  const isDoorHinged = input.isDoor && input.systemType === SystemType.HINGED

  const innerX = NOMINAL_FRAME_FACE_MM
  const innerY = NOMINAL_FRAME_FACE_MM
  const innerWidth = Math.max(width - 2 * NOMINAL_FRAME_FACE_MM, 1)
  const innerHeight = Math.max(height - NOMINAL_FRAME_FACE_MM - (isDoorHinged ? 0 : NOMINAL_FRAME_FACE_MM), 1)

  const parts: WindowPart[] = [
    { id: 'frame', kind: 'frame', index: 0, panelIndex: 0, rectMm: { x: 0, y: 0, width, height } },
  ]

  const isHinged = input.systemType === SystemType.HINGED
  const isDoubleDoorHinged =
    isHinged && !!input.openingType && DOUBLE_DOOR_OPENING_TYPES.includes(input.openingType)
  const mullionAxis: 'vertical' | 'horizontal' | null = !isHinged
    ? null
    : input.openingType === HingedOpeningType.FIXED_VERTICAL_MULLION
      ? 'vertical'
      : input.openingType === HingedOpeningType.FIXED_HORIZONTAL_MULLION
        ? 'horizontal'
        : null

  const sashRects: RectMm[] =
    input.systemType === SystemType.SLIDING
      ? buildSlidingSashRects(innerX, innerY, innerWidth, innerHeight)
      : isDoubleDoorHinged
        ? buildDoubleLeafSashRects(innerX, innerY, innerWidth, innerHeight)
        : [{ x: innerX, y: innerY, width: innerWidth, height: innerHeight }]

  sashRects.forEach((rect, index) => {
    parts.push({ id: `sash-${index}`, kind: 'sash', index, panelIndex: 0, rectMm: rect })
    const opening = insetRect(rect, NOMINAL_GLAZING_BEAD_MM)
    // A fixed-mullion opening type splits ONE sash's glass into two
    // independently-selectable lights, split by a static bar — every
    // other opening type (including double-door, which already gets two
    // real sashes above) keeps the usual one light per sash.
    const glassRects = mullionAxis ? splitRectWithMullion(opening, mullionAxis, NOMINAL_MULLION_BAR_MM) : [opening]
    glassRects.forEach((glassRect, lightIndex) => {
      parts.push({ id: `glass-${index}-${lightIndex}`, kind: 'glass', index, panelIndex: 0, rectMm: glassRect })
    })
  })

  // Only drawn once actually checked — no "ghost" preview of an unset
  // option, even when the frame would allow one.
  if (input.flyScreenAllowed && input.hasFlyScreen) {
    const flyScreenRect =
      input.systemType === SystemType.SLIDING ? sashRects[sashRects.length - 1] : { x: innerX, y: innerY, width: innerWidth, height: innerHeight }
    parts.push({ id: 'flyScreen', kind: 'flyScreen', index: 0, panelIndex: 0, rectMm: flyScreenRect })
  }

  return { outerMm: { width, height }, parts }
}

function buildSlidingSashRects(x: number, y: number, width: number, height: number): RectMm[] {
  const sashWidth = width / 2 + NOMINAL_SLIDING_INTERLOCK_MM / 2
  return [
    { x, y, width: sashWidth, height },
    { x: x + width - sashWidth, y, width: sashWidth, height },
  ]
}

// Two hinged leaves meeting flush in the middle — unlike
// buildSlidingSashRects, there's no overlap/interlock: a sliding sash
// needs one to physically pass behind the other, but two hinged leaves
// swing on their own outer edges and just abut at a shared centre
// stile. Each leaf's own NOMINAL_GLAZING_BEAD_MM-wide sash ring, sitting
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

function insetRect(rect: RectMm, inset: number): RectMm {
  const width = Math.max(rect.width - 2 * inset, 1)
  const height = Math.max(rect.height - 2 * inset, 1)
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
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

/** One panel's worth of layout input, plus where it sits. */
export interface AssemblyPanelInput extends WindowLayoutInput, PanelPlacement {}

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

/** `"p1:sash-0"` → `{ panelIndex: 1, localId: "sash-0" }`; `null` for an
 * unprefixed id (a single-panel `buildWindowLayout()` result, or the
 * assembly-level `'assembly'` issue id). */
export function parsePartId(partId: string): { panelIndex: number; localId: string } | null {
  const match = /^p(\d+):(.+)$/.exec(partId)
  if (!match) return null
  return { panelIndex: Number(match[1]), localId: match[2] }
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
 */
export function freeSidesOf(selection: PanelPlacement[], all: PanelPlacement[]): PanelSide[] {
  if (selection.length === 0) return []
  const box = unionRect(selection.map(panelRect))
  const others = all.filter((p) => !selection.includes(p))

  return PANEL_SIDES.filter((side) => {
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

function offsetRect(rect: RectMm, dx: number, dy: number): RectMm {
  return { ...rect, x: rect.x + dx, y: rect.y + dy }
}
