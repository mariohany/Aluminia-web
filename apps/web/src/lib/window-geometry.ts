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
    { id: 'frame', kind: 'frame', index: 0, rectMm: { x: 0, y: 0, width, height } },
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
    parts.push({ id: `sash-${index}`, kind: 'sash', index, rectMm: rect })
    const opening = insetRect(rect, NOMINAL_GLAZING_BEAD_MM)
    // A fixed-mullion opening type splits ONE sash's glass into two
    // independently-selectable lights, split by a static bar — every
    // other opening type (including double-door, which already gets two
    // real sashes above) keeps the usual one light per sash.
    const glassRects = mullionAxis ? splitRectWithMullion(opening, mullionAxis, NOMINAL_MULLION_BAR_MM) : [opening]
    glassRects.forEach((glassRect, lightIndex) => {
      parts.push({ id: `glass-${index}-${lightIndex}`, kind: 'glass', index, rectMm: glassRect })
    })
  })

  // Only drawn once actually checked — no "ghost" preview of an unset
  // option, even when the frame would allow one.
  if (input.flyScreenAllowed && input.hasFlyScreen) {
    const flyScreenRect =
      input.systemType === SystemType.SLIDING ? sashRects[sashRects.length - 1] : { x: innerX, y: innerY, width: innerWidth, height: innerHeight }
    parts.push({ id: 'flyScreen', kind: 'flyScreen', index: 0, rectMm: flyScreenRect })
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
