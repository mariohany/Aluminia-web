import { HeadShape } from '@repo/types/windows'
import type { RectMm } from '@/lib/window-geometry'

// Pure geometry for an arched panel head — no React, no lookups, no
// API, same posture as window-geometry.ts. See
// docs/arch_windows_planing.md §1 for the decisions this encodes.
//
// `HeadShape` is imported from the shared contract rather than
// declared locally — one source of truth for the four strings, same
// posture as `HingedOpeningType` in window-geometry.ts.

export interface PointMm {
  x: number
  y: number
}

/**
 * A panel's bounding rect, unchanged, plus what its top edge does
 * inside it. `rect` stays the same rectangle every placement invariant
 * already reads — the curve is subtracted from it, never grown outside
 * it. `riseMm` is the vertical distance from `rect.y` (the apex, or the
 * flat top edge) down to the springing line; it is `0` iff
 * `shape === HeadShape.FLAT`.
 */
export interface HeadOutline {
  rect: RectMm
  shape: HeadShape
  riseMm: number
}

/** `rect.y + riseMm` — the horizontal line the jambs meet the curve
 * on. `0` rise (a flat head) puts it at the top edge, which is fine:
 * bars are never drawn on a flat head (see the planing doc's decision
 * 11), so the degenerate case is never actually anchored to. */
function springY(o: HeadOutline): number {
  return o.rect.y + o.riseMm
}

function halfWidth(o: HeadOutline): number {
  return o.rect.width / 2
}

function centerX(o: HeadOutline): number {
  return o.rect.x + halfWidth(o)
}

// ---- Round / segmental: one circular arc -----------------------------
//
// R = (halfWidth² + rise²) / (2·rise) — the standard segmental-arch
// formula, derived from R² = halfWidth² + (R − rise)² (the springing
// point and the apex are both distance R from the centre). `round` is
// this same formula with rise pinned to halfWidth: substituting
// rise = hw collapses it to R = hw, i.e. a true semicircle — so round
// needs no separate derivation, only the normalisation that pins its
// rise (done server-side on write, and by `normalizeHeadRise` below on
// the client).

interface Arc {
  cx: number
  cy: number
  r: number
}

/** The single arc for `round`/`segmental` heads. Centre sits on the
 * panel's vertical centreline; `cy = rect.y + r` always, since the apex
 * (the topmost point of the circle) sits exactly at `rect.y`. */
function segmentalArc(o: HeadOutline): Arc {
  const hw = halfWidth(o)
  const rise = o.riseMm
  const r = (hw * hw + rise * rise) / (2 * rise)
  return { cx: centerX(o), cy: o.rect.y + r, r }
}

/** Half the angular sweep of a round/segmental arc, i.e. the angle
 * (radians, from straight up) at which each springing point sits.
 * `atan2` rather than `asin` so it stays well-defined even for a rise
 * taller than the half-width (a "stilted" arch), where the springing
 * point sits past the horizontal from the centre. */
function segmentalHalfSweep(o: HeadOutline, arc: Arc): number {
  return Math.atan2(halfWidth(o), arc.r - o.riseMm)
}

/** `phi` measured from straight up (`0` = apex), positive toward the
 * right springing point — screen coordinates, so `+phi` moves `+x`. */
function pointOnArc(arc: Arc, phi: number): PointMm {
  return { x: arc.cx + arc.r * Math.sin(phi), y: arc.cy - arc.r * Math.cos(phi) }
}

// ---- Gothic: two arcs meeting at a point ------------------------------
//
// Each arc springs from one bottom corner and is centred on the
// opposite side of the panel's centreline, at springing height — "the
// radius follows from the rise" per the planing doc. Left arc centre at
// (cx + m, springY); by construction it passes through both the left
// springing point (distance hw + m away, purely horizontal) and the
// apex (distance √(m² + rise²)). Setting those equal and solving for m
// gives the same shape of formula as the segmental one, with halfWidth
// and rise swapping roles in the denominator.

interface GothicArcs {
  left: Arc
  right: Arc
}

function gothicArcs(o: HeadOutline): GothicArcs {
  const hw = halfWidth(o)
  const rise = o.riseMm
  const m = (rise * rise - hw * hw) / (2 * hw)
  const r = hw + m
  const y = springY(o)
  return {
    left: { cx: centerX(o) + m, cy: y, r },
    right: { cx: centerX(o) - m, cy: y, r },
  }
}

/** Sweep angle of one gothic arc, from its own springing point to the
 * apex. In `pointOnArc`'s convention the *left* arc's springing point
 * (straight out to its own left, i.e. direction `(-1, 0)` from its
 * centre) sits at `phi = -π/2`, and its apex sits at
 * `atan2(-m, rise)` — both arcs are the same radius and, by
 * symmetry, the same sweep, so one number covers both. */
function gothicSweep(o: HeadOutline, arcs: GothicArcs): number {
  const m = arcs.left.r - halfWidth(o)
  return Math.PI / 2 - Math.atan2(m, o.riseMm)
}

function gothicApex(arcs: GothicArcs, o: HeadOutline): PointMm {
  // On the centreline, both arcs meet by symmetry — solve the left
  // arc's circle equation at x = centerX(o) and take the upper root.
  const dx = centerX(o) - arcs.left.cx
  const dy = Math.sqrt(Math.max(arcs.left.r * arcs.left.r - dx * dx, 0))
  return { x: centerX(o), y: arcs.left.cy - dy }
}

// ---- Public: the curve itself ------------------------------------------

/** A point on the head curve, `t ∈ [0,1]` as a fraction of **arc
 * length** from the left springing point — not angle, so gothic's two
 * equal-length but differently-centred arcs still share one
 * consistent parametrisation, and a bar keeps a sensible position if
 * the rise later changes. */
export function headPointAt(o: HeadOutline, t: number): PointMm {
  const clamped = Math.min(Math.max(t, 0), 1)
  if (o.shape === HeadShape.FLAT) {
    return { x: o.rect.x + o.rect.width * clamped, y: o.rect.y }
  }
  if (o.shape === HeadShape.GOTHIC) {
    const arcs = gothicArcs(o)
    const sweep = gothicSweep(o, arcs)
    if (clamped <= 0.5) {
      const phi = -Math.PI / 2 + (clamped / 0.5) * sweep
      return pointOnArc(arcs.left, phi)
    }
    const apexPhiRight = Math.PI / 2 - sweep
    const phi = apexPhiRight + ((clamped - 0.5) / 0.5) * sweep
    return pointOnArc(arcs.right, phi)
  }
  const arc = segmentalArc(o)
  const halfSweep = segmentalHalfSweep(o, arc)
  const phi = -halfSweep + clamped * (2 * halfSweep)
  return pointOnArc(arc, phi)
}

/** A point on the springing line, `t ∈ [0,1]` left → right. Bars
 * anchor here (`on: 'sill'`) as well as on the curve — the fan
 * window's spokes all start at `t = 0.5` of this line. */
export function sillPointAt(o: HeadOutline, t: number): PointMm {
  const clamped = Math.min(Math.max(t, 0), 1)
  return { x: o.rect.x + o.rect.width * clamped, y: springY(o) }
}

/** Total length of the head curve alone (not the jambs or sill). For a
 * flat head this is exactly `rect.width`, which is what makes
 * `outlinePerimeterMm`'s flat case reduce to `2·(w+h)`. */
export function headLengthMm(o: HeadOutline): number {
  if (o.shape === HeadShape.FLAT) return o.rect.width
  if (o.shape === HeadShape.GOTHIC) {
    const arcs = gothicArcs(o)
    return 2 * gothicSweep(o, arcs) * arcs.left.r // both arcs share radius and sweep, by symmetry
  }
  const arc = segmentalArc(o)
  return 2 * segmentalHalfSweep(o, arc) * arc.r
}

/** Nearest-point inverse of `headPointAt` — used to resolve a pointer
 * position to a `t` while drawing. For the single-arc shapes this is
 * exact (project onto the arc's angle and clamp); for gothic, whichever
 * arc's projected point lands closer to `p` wins. */
export function tAtHeadPoint(o: HeadOutline, p: PointMm): number {
  if (o.shape === HeadShape.FLAT) {
    return o.rect.width === 0 ? 0 : Math.min(Math.max((p.x - o.rect.x) / o.rect.width, 0), 1)
  }
  if (o.shape === HeadShape.GOTHIC) {
    const arcs = gothicArcs(o)
    const sweep = gothicSweep(o, arcs)
    const apexPhiLeft = -Math.PI / 2 + sweep
    const apexPhiRight = Math.PI / 2 - sweep

    const rawPhiL = Math.atan2(p.x - arcs.left.cx, -(p.y - arcs.left.cy))
    const phiL = Math.min(Math.max(rawPhiL, -Math.PI / 2), apexPhiLeft)
    const tL = ((phiL + Math.PI / 2) / sweep) * 0.5
    const candL = pointOnArc(arcs.left, phiL)

    const rawPhiR = Math.atan2(p.x - arcs.right.cx, -(p.y - arcs.right.cy))
    const phiR = Math.min(Math.max(rawPhiR, apexPhiRight), Math.PI / 2)
    const tR = 0.5 + ((phiR - apexPhiRight) / sweep) * 0.5
    const candR = pointOnArc(arcs.right, phiR)

    const dL = Math.hypot(p.x - candL.x, p.y - candL.y)
    const dR = Math.hypot(p.x - candR.x, p.y - candR.y)
    return dL <= dR ? Math.min(Math.max(tL, 0), 0.5) : Math.min(Math.max(tR, 0.5), 1)
  }
  const arc = segmentalArc(o)
  const halfSweep = segmentalHalfSweep(o, arc)
  const phi = Math.atan2(p.x - arc.cx, -(p.y - arc.cy))
  const clampedPhi = Math.min(Math.max(phi, -halfSweep), halfSweep)
  return (clampedPhi + halfSweep) / (2 * halfSweep)
}

/** Perimeter of the whole outline — both jambs, the sill, and the head
 * curve. This is what `computeSashWeightKg` moves to (see planing doc
 * §7): for a flat head it is exactly `2·(w+h)`, so every existing
 * window's weight is unchanged by this feature. */
export function outlinePerimeterMm(o: HeadOutline): number {
  const jambHeight = o.rect.height - o.riseMm
  return 2 * jambHeight + o.rect.width + headLengthMm(o)
}

// ---- Inset: frame → sash → glass, staying an exact arc -----------------
//
// The offset of a straight line is a straight line; the offset of a
// circular arc is a concentric arc. So insetting by `d` keeps every
// arc's centre and just shrinks its radius by `d` — then the new
// springing point is wherever that smaller circle actually crosses the
// jamb now sitting `d` further in. That crossing point is *computed*,
// not assumed to sit at the same height as before (it generally
// doesn't for a segmental arch), which is what keeps this exact rather
// than an approximation, and what keeps it composable — insetting twice
// by d1 then d2 gives the same outline as insetting once by d1+d2.

/** Where does a circle of radius `r` about `(cx, cy)` cross the
 * vertical line `x = atX`, on the upper (smaller-y) branch? `null` if
 * the line misses the circle entirely — the caller clamps before this
 * can happen in practice, mirroring `insetRect`'s own floor. */
function upperCircleCrossing(arc: Arc, atX: number): PointMm | null {
  const dx = atX - arc.cx
  const under = arc.r * arc.r - dx * dx
  if (under < 0) return null
  return { x: atX, y: arc.cy - Math.sqrt(under) }
}

/** Insets an outline by `d` on every side — the arched sibling of
 * `insetRect`. `d` is clamped so the result never collapses to a
 * negative span, same posture as `insetRect`'s own `Math.max(…, 1)`
 * floor. */
export function insetHeadOutline(o: HeadOutline, d: number): HeadOutline {
  const maxD = Math.min(o.rect.width / 2 - 0.5, o.rect.height / 2 - 0.5, o.shape === HeadShape.FLAT ? Infinity : o.riseMm - 0.5)
  const clampedD = Math.min(Math.max(d, 0), Math.max(maxD, 0))

  const newX = o.rect.x + clampedD
  const newWidth = Math.max(o.rect.width - 2 * clampedD, 1)
  const bottomY = o.rect.y + o.rect.height - clampedD

  if (o.shape === HeadShape.FLAT) {
    return { rect: { x: newX, y: o.rect.y + clampedD, width: newWidth, height: Math.max(bottomY - (o.rect.y + clampedD), 1) }, shape: HeadShape.FLAT, riseMm: 0 }
  }

  if (o.shape === HeadShape.GOTHIC) {
    const arcs = gothicArcs(o)
    const rNew = Math.max(arcs.left.r - clampedD, 0.5)
    const leftNew: Arc = { cx: arcs.left.cx, cy: arcs.left.cy, r: rNew }
    const rightNew: Arc = { cx: arcs.right.cx, cy: arcs.right.cy, r: rNew }
    const crossing = upperCircleCrossing(leftNew, newX) ?? { x: newX, y: arcs.left.cy }
    const apex = gothicApex({ left: leftNew, right: rightNew }, o) // uses centerX(o), unaffected by inset
    const apexY = Math.min(apex.y, crossing.y - 0.5)
    return {
      rect: { x: newX, y: apexY, width: newWidth, height: Math.max(bottomY - apexY, 1) },
      shape: HeadShape.GOTHIC,
      riseMm: Math.max(crossing.y - apexY, 1),
    }
  }

  const arc = segmentalArc(o)
  const rNew = Math.max(arc.r - clampedD, 0.5)
  const arcNew: Arc = { cx: arc.cx, cy: arc.cy, r: rNew }
  const crossing = upperCircleCrossing(arcNew, newX) ?? { x: newX, y: arc.cy - rNew }
  const apexY = arc.cy - rNew
  return {
    rect: { x: newX, y: apexY, width: newWidth, height: Math.max(bottomY - apexY, 1) },
    shape: o.shape,
    riseMm: Math.max(crossing.y - apexY, 1),
  }
}

// ---- Bar cut length and the sag↔radius binding --------------------------
//
// `sagMm` is what's stored (see docs/arch_windows_planing.md §2's "why
// sag, not radius"): it stays finite and well-behaved as a bar
// flattens, where radius runs to infinity. Radius is what the user
// types and what a work order will print, so both directions are
// exposed and are exact inverses of one another.

/** `null` means "straight — infinite radius", never a thrown error;
 * callers show `∞ · straight` for that case (see §6.5). */
export function radiusFromSag(chordMm: number, sagMm: number): number | null {
  if (sagMm === 0) return null
  const s = Math.abs(sagMm)
  return (chordMm * chordMm) / (8 * s) + s / 2
}

/** Inverse of `radiusFromSag`. A chord cannot sit on a circle smaller
 * than its own half-length, so a typed radius below that is clamped to
 * the minimum rather than producing a NaN — the UI shows that clamped
 * value back rather than silently discarding the input. Returns a
 * magnitude; the caller applies whatever sign the bar is currently
 * bowed in (a typed radius alone carries no direction). */
export function sagFromRadius(chordMm: number, radiusMm: number): number {
  const half = chordMm / 2
  const r = Math.max(radiusMm, half)
  return r - Math.sqrt(r * r - half * half)
}

/** The developed (cut) length of a bar — the chord itself when
 * straight, otherwise the arc length `2R·asin(chord / 2R)`. This, not
 * the chord, is what a bender is set to and what a work order prints. */
export function barCutLengthMm(chordMm: number, sagMm: number): number {
  const r = radiusFromSag(chordMm, sagMm)
  if (r === null) return chordMm
  const half = Math.min(chordMm / (2 * r), 1)
  return 2 * r * Math.asin(half)
}

/** Keeps `round` pinned to a true semicircle and `flat` pinned to no
 * rise at all — the client-side half of the normalisation the planing
 * doc puts server-side too (§4), so the UI never shows a stale rise
 * while the user is still dragging the width. Also clamps below
 * `heightMm`, for every shape: a rise at or beyond the panel's own
 * height leaves no jamb at all — the springing line would fall AT OR
 * BELOW the panel's own bottom edge, and the curve would extend past
 * its declared rect entirely rather than being subtracted from within
 * it (see `HeadOutline`'s own doc comment — the whole model is built
 * on the curve staying inside the rect, never growing outside it).
 * Reachable for real: `round`'s rise is `widthMm / 2` with no
 * awareness of height at all, so a wide, short panel (a transom, say
 * 3000×500) demands a rise of 1500 — more than triple its own height.
 * Found live (a real user report, not a hypothetical): the arch
 * rendered ballooning out past the panel's own bounds instead of a
 * plausible curve. Every caller funnels through here (the UI on every
 * keystroke, the server on write, and `buildWindowLayout` itself right
 * before it builds the outline actually rendered) — this is the one
 * place that guarantees a storable, renderable rise regardless of how
 * an otherwise-valid rise ends up paired with a since-shrunk height or
 * since-grown width. */
export function normalizeHeadRise(shape: HeadShape, widthMm: number, riseMm: number, heightMm: number): number {
  if (shape === HeadShape.FLAT) return 0
  const raw = shape === HeadShape.ROUND ? widthMm / 2 : riseMm
  return Math.min(raw, heightMm - 1)
}

/** The minimum rise a gothic head needs to stay a simple, buildable
 * closed curve. In `gothicArcs` (above), `m = (rise² − halfWidth²) /
 * (2·halfWidth)` — the horizontal offset of each arc's centre from the
 * panel's own centreline, onto the *opposite* side from its springing
 * point. Below `rise === halfWidth` (`m ≤ 0`), that centre lands on the
 * SAME side as its own springing point instead, and the "point" turns
 * into a re-entrant dip — a shape that self-intersects rather than
 * meeting cleanly at an apex, and that no fabricator could actually
 * bend. Exactly `widthMm / 2`; kept as its own named function rather
 * than an inlined `widthMm / 2` so the *reason* travels with every call
 * site that needs it (the UI's rise input `min`, its default-on-select
 * value) instead of being a bare number that looks like a typo. */
export function minGothicRiseMm(widthMm: number): number {
  return widthMm / 2
}
