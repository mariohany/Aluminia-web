import {
  barCutLengthMm,
  headLengthMm,
  headPointAt,
  radiusFromSag,
  sillPointAt,
  tAtHeadPoint,
  type HeadOutline,
  type PointMm,
} from '@/lib/arch-geometry'

// The bar graph a user draws inside an arched head — anchors, cascade
// delete, snapping. Pure: no React, no lookups, no API. See
// docs/arch_windows_planing.md §2 for the decisions this encodes.

/**
 * An endpoint names what it is attached to, not a coordinate — the
 * whole reason a dependent can follow a move with no propagation code,
 * and the reason delete has to cascade. `on: string` (a bar id) is only
 * ever legal when that bar sits at a strictly lower index in the same
 * panel's `bars` array (see `barsAreOrdered`) — the reference graph is
 * a DAG by construction, so no cycle detection is needed to keep it
 * one; `resolveAnchor`'s visiting-set guard below exists only as
 * defensive insurance against a transiently invalid state mid-edit,
 * not because a cycle is ever supposed to reach it.
 */
export type BarAnchor =
  | { on: 'arch'; at: number } // 0..1 arc-length fraction of the head curve
  | { on: 'sill'; at: number } // 0..1 along the springing line, left → right
  | { on: string; at: number } // a bar id; 0..1 along that bar, from → to

export interface WindowBar {
  id: string
  from: BarAnchor
  to: BarAnchor
  /** `0` = straight. Signed — positive bows to the left of the
   * from→to direction (see `pointAlongBar`'s `perp` for exactly which
   * side that is). Sag, not radius, is what's stored: it stays finite
   * and well-behaved as a bar flattens, where radius runs to infinity —
   * see arch-geometry.ts's `radiusFromSag`/`sagFromRadius`. */
  sagMm: number
}

function dist(a: PointMm, b: PointMm): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function lerpPoint(a: PointMm, b: PointMm, t: number): PointMm {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function clamp01(t: number): number {
  return Math.min(Math.max(t, 0), 1)
}

/** Shortest signed rotation from angle `from` to angle `to`, in
 * `(-π, π]` — the building block for sweeping a bar's own arc through
 * its bow peak without picking the long way around by accident. */
function angleDiff(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}

// ---- A bar's own curve: two points plus a signed sag -------------------
//
// A straight bar (`sagMm === 0`) is a plain lerp. A bowed one is a
// circular arc through `from` and `to` with a sagitta of `sagMm` at its
// midpoint — same sagitta construction `arch-geometry.ts` uses for
// bend radius, just built from two arbitrary points instead of a head
// outline's own springing points. Parametrised by arc length (two
// half-sweeps either side of the bow peak, mirroring how
// `headPointAt` handles the gothic head's two arcs), so `t = 0.5` is
// always the actual bow peak, not merely the chord midpoint.

interface BarArc {
  center: PointMm
  r: number
  aFrom: number
  aPeak: number
  aTo: number
}

function barArcGeometry(from: PointMm, to: PointMm, sagMm: number): BarArc | null {
  if (sagMm === 0) return null
  const chord = dist(from, to)
  const r = radiusFromSag(chord, sagMm)
  if (r === null) return null // unreachable (sagMm !== 0 here), kept for the type
  const dir = { x: (to.x - from.x) / chord, y: (to.y - from.y) / chord }
  const perp = { x: -dir.y, y: dir.x }
  const mid = lerpPoint(from, to, 0.5)
  const sign = sagMm > 0 ? 1 : -1
  const center = { x: mid.x + perp.x * (sagMm - r * sign), y: mid.y + perp.y * (sagMm - r * sign) }
  const peak = { x: mid.x + perp.x * sagMm, y: mid.y + perp.y * sagMm }
  return {
    center,
    r,
    aFrom: Math.atan2(from.y - center.y, from.x - center.x),
    aPeak: Math.atan2(peak.y - center.y, peak.x - center.x),
    aTo: Math.atan2(to.y - center.y, to.x - center.x),
  }
}

function pointOnBarArc(arc: BarArc, phi: number): PointMm {
  return { x: arc.center.x + arc.r * Math.cos(phi), y: arc.center.y + arc.r * Math.sin(phi) }
}

/** A point at fraction `t ∈ [0,1]` along a bar's own curve, `from → to`.
 * Exported so `window-shapes.tsx`'s `barPath` can sample the same
 * verified curve for drawing rather than re-deriving SVG arc-flag
 * maths of its own — see arch-geometry.ts §2's numeric-verification
 * note on why a second, independent geometry derivation is worth
 * avoiding. */
export function pointAlongBar(from: PointMm, to: PointMm, sagMm: number, t: number): PointMm {
  const c = clamp01(t)
  const arc = barArcGeometry(from, to, sagMm)
  if (!arc) return lerpPoint(from, to, c)
  const sweepToPeak = angleDiff(arc.aFrom, arc.aPeak)
  const sweepFromPeak = angleDiff(arc.aPeak, arc.aTo)
  const phi = c <= 0.5 ? arc.aFrom + sweepToPeak * (c / 0.5) : arc.aPeak + sweepFromPeak * ((c - 0.5) / 0.5)
  return pointOnBarArc(arc, phi)
}

/** The exact inverse of `barArcGeometry`'s own `peak` (`peak = mid +
 * perp * sagMm`) — the SIGNED perpendicular distance of an arbitrary
 * point from the chord `from → to`, along that same `perp`. This is
 * what a midpoint-handle drag needs to turn a pointer position into
 * `sagMm` (§6.5): reusing the forward formula's own `dir`/`perp`
 * construction rather than re-deriving "which side is positive" a
 * second time, independently, is the whole point — see arch-
 * geometry.ts §2's numeric-verification note on why that's worth
 * avoiding. `0` for a degenerate zero-length chord (nothing to be
 * perpendicular to). */
export function sagFromDragPoint(from: PointMm, to: PointMm, p: PointMm): number {
  const chord = dist(from, to)
  if (chord === 0) return 0
  const dir = { x: (to.x - from.x) / chord, y: (to.y - from.y) / chord }
  const perp = { x: -dir.y, y: dir.x }
  const mid = lerpPoint(from, to, 0.5)
  return (p.x - mid.x) * perp.x + (p.y - mid.y) * perp.y
}

/** Nearest-point inverse of `pointAlongBar` — projects an arbitrary
 * point onto the bar's own curve and returns its `t`, clamped to
 * `[0,1]`. Used both to resolve a click "N mm along this bar" and, via
 * the distance from the projected point back to the input, to test
 * whether a pointer is close enough to the curve to snap to it at all. */
function tAlongBar(from: PointMm, to: PointMm, sagMm: number, p: PointMm): number {
  const arc = barArcGeometry(from, to, sagMm)
  if (!arc) {
    const chordSq = (to.x - from.x) ** 2 + (to.y - from.y) ** 2
    if (chordSq === 0) return 0
    const t = ((p.x - from.x) * (to.x - from.x) + (p.y - from.y) * (to.y - from.y)) / chordSq
    return clamp01(t)
  }
  const sweepToPeak = angleDiff(arc.aFrom, arc.aPeak)
  const sweepFromPeak = angleDiff(arc.aPeak, arc.aTo)
  const phiRaw = Math.atan2(p.y - arc.center.y, p.x - arc.center.x)

  const phi1 = arc.aFrom + Math.min(Math.max(angleDiff(arc.aFrom, phiRaw), 0), sweepToPeak) * Math.sign(sweepToPeak || 1)
  const t1 = clamp01((angleDiff(arc.aFrom, phi1) / (sweepToPeak || 1)) * 0.5)
  const cand1 = pointOnBarArc(arc, phi1)

  const phi2 = arc.aPeak + Math.min(Math.max(angleDiff(arc.aPeak, phiRaw), 0), sweepFromPeak) * Math.sign(sweepFromPeak || 1)
  const t2 = 0.5 + clamp01((angleDiff(arc.aPeak, phi2) / (sweepFromPeak || 1)) * 0.5)
  const cand2 = pointOnBarArc(arc, phi2)

  return dist(p, cand1) <= dist(p, cand2) ? t1 : t2
}

// ---- Resolving anchors and whole bars -----------------------------------

const MAX_RESOLVE_DEPTH = 64 // real chains are a handful deep; this is a cheap ceiling against a transiently-invalid cycle, not a real limit

function resolveAnchorGuarded(a: BarAnchor, bars: WindowBar[], o: HeadOutline, visiting: ReadonlySet<string>): PointMm | null {
  if (a.on === 'arch') return headPointAt(o, a.at)
  if (a.on === 'sill') return sillPointAt(o, a.at)
  if (visiting.has(a.on) || visiting.size >= MAX_RESOLVE_DEPTH) return null
  const bar = bars.find((b) => b.id === a.on)
  if (!bar) return null
  const nextVisiting = new Set(visiting)
  nextVisiting.add(a.on)
  const from = resolveAnchorGuarded(bar.from, bars, o, nextVisiting)
  const to = resolveAnchorGuarded(bar.to, bars, o, nextVisiting)
  if (!from || !to) return null
  return pointAlongBar(from, to, bar.sagMm, a.at)
}

/** Resolves an anchor — `'arch'`, `'sill'`, or a bar id — to an actual
 * point, recursing through however many bars it's chained onto.
 * `null` on a dangling reference (a bar mid-delete, a half-applied
 * edit) rather than throwing: a renderer must never crash on a
 * transiently invalid state. */
export function resolveAnchor(a: BarAnchor, bars: WindowBar[], o: HeadOutline): PointMm | null {
  return resolveAnchorGuarded(a, bars, o, new Set())
}

/** Resolves both ends of a bar. `null` if either end is dangling. */
export function resolveBar(b: WindowBar, bars: WindowBar[], o: HeadOutline): { from: PointMm; to: PointMm } | null {
  const visiting = new Set([b.id])
  const from = resolveAnchorGuarded(b.from, bars, o, visiting)
  const to = resolveAnchorGuarded(b.to, bars, o, visiting)
  if (!from || !to) return null
  return { from, to }
}

/** A bar's own real cut length — its resolved chord run through
 * `barCutLengthMm`. Kept as its own export, separate from
 * `readoutFor`'s own inline version of the same two lines below, so
 * the Bar section in window-part-panel.tsx (via window-editor-page.tsx) has
 * something to call without touching `readoutFor` itself — that
 * function is already shipped and being manually verified by the user
 * for an unrelated step, not something to risk a behavioural drift in
 * for this one. `null` if either end is dangling. */
export function barLengthMm(bar: WindowBar, bars: WindowBar[], o: HeadOutline): number | null {
  const resolved = resolveBar(bar, bars, o)
  if (!resolved) return null
  return barCutLengthMm(dist(resolved.from, resolved.to), bar.sagMm)
}

// ---- Cascade: move follows, delete cascades ------------------------------

/** Every bar that references `id`, directly or through a chain of other
 * bars — a fixed-point closure, the same shape as
 * `panelsPushedRight`/`panelsPushedUp`'s exclusion pass in
 * window-geometry.ts, and for the same reason: one pass over the array
 * isn't enough once dependencies chain more than one deep. Does not
 * include `id` itself. */
export function dependentsOf(id: string, bars: WindowBar[]): Set<string> {
  const doomed = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const b of bars) {
      if (b.id === id || doomed.has(b.id)) continue
      if (b.from.on === id || b.to.on === id || doomed.has(b.from.on) || doomed.has(b.to.on)) {
        doomed.add(b.id)
        changed = true
      }
    }
  }
  return doomed
}

/** Deletes a bar and everything transitively anchored to it — a
 * dependent's position is undefined once its anchor is gone, so
 * leaving it behind would mean inventing coordinates the user never
 * chose. */
export function removeBarCascade(bars: WindowBar[], id: string): WindowBar[] {
  const doomed = dependentsOf(id, bars)
  doomed.add(id)
  return bars.filter((b) => !doomed.has(b.id))
}

/** True iff every bar's anchors reference only `'arch'`, `'sill'`, or a
 * bar that appears **earlier** in the array. This is the whole
 * acyclicity guarantee — drawing order doubles as the cycle guard, so
 * nothing else needs to check for one. Re-implemented independently in
 * `windows.service.ts` rather than trusted from the client, same
 * posture as every other assembly invariant there. */
export function barsAreOrdered(bars: WindowBar[]): boolean {
  const seenIds = new Set<string>()
  for (const b of bars) {
    for (const anchor of [b.from, b.to]) {
      if (anchor.on !== 'arch' && anchor.on !== 'sill' && !seenIds.has(anchor.on)) return false
    }
    seenIds.add(b.id)
  }
  return true
}

// ---- Snapping while drawing -----------------------------------------------
//
// Priority order per docs/arch_windows_planing.md §2: an existing bar's
// own endpoint, a fractional stop (½,⅓,⅔) on the head/sill/a bar, the
// head curve itself, the springing line, then a free point along a
// single bar. A bar×bar crossing is never a target — rather than a
// special case bolted on, that falls straight out of the last tier:
// if a point is within tolerance of two or more distinct bars at once,
// it's ambiguous by definition (that's what a crossing *is*), so
// `barsWithinTolerance` returning more than one match means "refuse",
// not "pick one".

const FRACTIONAL_STOPS = [0.5, 1 / 3, 2 / 3]

function barsWithinTolerance(p: PointMm, bars: WindowBar[], o: HeadOutline, toleranceMm: number): BarAnchor[] {
  const hits: BarAnchor[] = []
  for (const b of bars) {
    const resolved = resolveBar(b, bars, o)
    if (!resolved) continue
    const t = tAlongBar(resolved.from, resolved.to, b.sagMm, p)
    const pt = pointAlongBar(resolved.from, resolved.to, b.sagMm, t)
    if (dist(p, pt) <= toleranceMm) hits.push({ on: b.id, at: t })
  }
  return hits
}

/** Resolves a pointer position to whatever it should snap to, or
 * `null` for free space / an ambiguous bar×bar crossing. */
export function snapTarget(p: PointMm, bars: WindowBar[], o: HeadOutline, toleranceMm: number): BarAnchor | null {
  // Tier 1 — an existing bar's own endpoint. Returned as that
  // endpoint's OWN anchor value (not `{on: barId, at: 0}`) so a new
  // bar sharing this point is anchored to the same thing the existing
  // endpoint is, one hop shallower.
  let best: BarAnchor | null = null
  let bestDist = toleranceMm
  for (const b of bars) {
    for (const anchor of [b.from, b.to]) {
      const pt = resolveAnchor(anchor, bars, o)
      if (!pt) continue
      const d = dist(p, pt)
      if (d <= bestDist) {
        bestDist = d
        best = anchor
      }
    }
  }
  if (best) return best

  // Tier 2 — fractional stops on the head, the springing line, and
  // every existing bar.
  const stopCandidates: BarAnchor[] = [
    ...FRACTIONAL_STOPS.map((at): BarAnchor => ({ on: 'arch', at })),
    ...FRACTIONAL_STOPS.map((at): BarAnchor => ({ on: 'sill', at })),
    ...bars.flatMap((b) => FRACTIONAL_STOPS.map((at): BarAnchor => ({ on: b.id, at }))),
  ]
  bestDist = toleranceMm
  best = null
  for (const c of stopCandidates) {
    const pt = resolveAnchor(c, bars, o)
    if (!pt) continue
    const d = dist(p, pt)
    if (d <= bestDist) {
      bestDist = d
      best = c
    }
  }
  if (best) return best

  // Tier 3 — the head curve, any point.
  const headT = tAtHeadPoint(o, p)
  if (dist(p, headPointAt(o, headT)) <= toleranceMm) return { on: 'arch', at: headT }

  // Tier 4 — the springing line, any point.
  const sillT = clamp01((p.x - o.rect.x) / o.rect.width)
  if (dist(p, sillPointAt(o, sillT)) <= toleranceMm) return { on: 'sill', at: sillT }

  // Tier 5 — a free point along exactly one bar. Two or more within
  // tolerance is a crossing; refuse rather than pick arbitrarily.
  const hits = barsWithinTolerance(p, bars, o, toleranceMm)
  return hits.length === 1 ? hits[0] : null
}

/** Is the pointer near where two (or more) bars cross? The dedicated
 * check `snapTarget` itself doesn't expose, since it only needs to know
 * "ambiguous → refuse" — this is for the hover readout to explain
 * *why* nothing snapped, rather than the cursor silently declining to
 * stick (decision 5). */
export function isNearBarCrossing(p: PointMm, bars: WindowBar[], o: HeadOutline, toleranceMm: number): boolean {
  return barsWithinTolerance(p, bars, o, toleranceMm).length >= 2
}

// ---- The hover readout -----------------------------------------------------

export interface Readout {
  line1: string
  line2: string
  warn: boolean
}

/** Shown while hovering a crossing — a static message, not derived from
 * geometry, since "two bars meet" is the whole content. */
export const CROSSING_READOUT: Readout = { line1: 'crossing', line2: 'two bars meet — no snap', warn: true }

/**
 * The two-line chip from §6.1's table, for whatever `snapTarget`
 * resolved (or `null` for free space — still shows real X/Y, just no
 * "on the arch"/"on bar N" second line). `point` carries the raw
 * pointer position so X/Y is always available even when `anchor` is
 * `null`; measured from the panel's left edge and up from the
 * springing line (`'sill'`'s own zero line), which is the natural
 * datum for anything being drawn in the head — not the panel's literal
 * bottom, which may sit far below through unrelated rectangular sashes.
 */
export function readoutFor(anchor: BarAnchor | null, point: PointMm, bars: WindowBar[], o: HeadOutline): Readout {
  const x = Math.round(point.x - o.rect.x)
  const y = Math.round(o.rect.y + o.riseMm - point.y)
  const xy = `X ${x} · Y ${y}`

  if (anchor === null) return { line1: xy, line2: 'free point', warn: false }
  if (anchor.on === 'arch') {
    const along = Math.round(headLengthMm(o) * anchor.at)
    return { line1: xy, line2: `on the arch · ${along} mm along`, warn: false }
  }
  if (anchor.on === 'sill') {
    return { line1: `X ${x}`, line2: 'on the springing line', warn: false }
  }
  const bar = bars.find((b) => b.id === anchor.on)
  const resolved = bar && resolveBar(bar, bars, o)
  if (!bar || !resolved) return { line1: xy, line2: 'free point', warn: false }
  const barLen = Math.round(barCutLengthMm(dist(resolved.from, resolved.to), bar.sagMm))
  const along = Math.round(barLen * anchor.at)
  return { line1: xy, line2: `bar ${bar.id} · ${along} of ${barLen} mm along it`, warn: false }
}
