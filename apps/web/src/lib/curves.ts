import type { PointMm } from '@/lib/arch-geometry'

// Lines and circular arcs, and the paths made of them — the shared
// maths under dividers.ts and light-graph.ts (docs/free_dividers_planing.md
// §3–§4). Pure: no React, no lookups. Screen coordinates (y down), angles
// in radians measured the screen way: a point on an arc is
// `c + r·(cos φ, sin φ)`, so a positive sweep turns clockwise on screen.
// Nothing here assumes which way is "up"; callers that care (the arch
// zone, the sill) say so themselves.

export type Seg =
  | { kind: 'line'; a: PointMm; b: PointMm }
  | { kind: 'arc'; c: PointMm; r: number; a0: number; sweep: number }

/** One member's centreline (or a light's edge): segments end to end. */
export type Path = Seg[]

const TAU = Math.PI * 2

export function dist(a: PointMm, b: PointMm): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function lerp(a: PointMm, b: PointMm, t: number): PointMm {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function clamp01(t: number): number {
  return Math.min(Math.max(t, 0), 1)
}

/** Shortest signed turn from angle `from` to angle `to`, in `(-π, π]`. */
export function angleDiff(from: number, to: number): number {
  let d = (to - from) % TAU
  if (d > Math.PI) d -= TAU
  if (d <= -Math.PI) d += TAU
  return d
}

function onCircle(c: PointMm, r: number, phi: number): PointMm {
  return { x: c.x + r * Math.cos(phi), y: c.y + r * Math.sin(phi) }
}

// ---- One segment ---------------------------------------------------------

export function segStart(s: Seg): PointMm {
  return s.kind === 'line' ? s.a : onCircle(s.c, s.r, s.a0)
}

export function segEnd(s: Seg): PointMm {
  return s.kind === 'line' ? s.b : onCircle(s.c, s.r, s.a0 + s.sweep)
}

export function segLength(s: Seg): number {
  return s.kind === 'line' ? dist(s.a, s.b) : Math.abs(s.sweep) * s.r
}

/** The point at fraction `u ∈ [0,1]` of the segment's own length. */
export function segPointAt(s: Seg, u: number): PointMm {
  return s.kind === 'line' ? lerp(s.a, s.b, u) : onCircle(s.c, s.r, s.a0 + s.sweep * u)
}

/** Unit tangent at `u`, pointing in the direction of travel. */
export function segTangentAt(s: Seg, u: number): PointMm {
  if (s.kind === 'line') {
    const len = dist(s.a, s.b) || 1
    return { x: (s.b.x - s.a.x) / len, y: (s.b.y - s.a.y) / len }
  }
  const phi = s.a0 + s.sweep * u
  const sign = s.sweep >= 0 ? 1 : -1
  return { x: -Math.sin(phi) * sign, y: Math.cos(phi) * sign }
}

export function segReverse(s: Seg): Seg {
  return s.kind === 'line' ? { kind: 'line', a: s.b, b: s.a } : { kind: 'arc', c: s.c, r: s.r, a0: s.a0 + s.sweep, sweep: -s.sweep }
}

/** The part of a segment between fractions `u0` and `u1` (either order;
 * `u1 < u0` returns it reversed). */
export function segSlice(s: Seg, u0: number, u1: number): Seg {
  if (s.kind === 'line') return { kind: 'line', a: lerp(s.a, s.b, u0), b: lerp(s.a, s.b, u1) }
  return { kind: 'arc', c: s.c, r: s.r, a0: s.a0 + s.sweep * u0, sweep: s.sweep * (u1 - u0) }
}

/** Nearest point on the segment to `p`: its fraction `u`, the point, and
 * the distance. */
export function segProject(s: Seg, p: PointMm): { u: number; point: PointMm; dist: number } {
  if (s.kind === 'line') {
    const dx = s.b.x - s.a.x
    const dy = s.b.y - s.a.y
    const lenSq = dx * dx + dy * dy
    const u = lenSq === 0 ? 0 : clamp01(((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / lenSq)
    const point = lerp(s.a, s.b, u)
    return { u, point, dist: dist(p, point) }
  }
  const phi = Math.atan2(p.y - s.c.y, p.x - s.c.x)
  const along = s.sweep === 0 ? 0 : angleDiff(s.a0, phi) / s.sweep
  // The projection can land just outside the sweep (or on the far side
  // of the circle, where `angleDiff` wraps): compare against both ends.
  const candidates = [0, 1]
  if (along >= 0 && along <= 1) candidates.push(along)
  const alt = s.sweep === 0 ? 0 : (angleDiff(s.a0, phi) + (s.sweep > 0 ? TAU : -TAU)) / s.sweep
  if (alt >= 0 && alt <= 1) candidates.push(alt)
  let best = { u: 0, point: segStart(s), dist: Infinity }
  for (const u of candidates) {
    const point = segPointAt(s, u)
    const d = dist(p, point)
    if (d < best.dist) best = { u, point, dist: d }
  }
  return best
}

// ---- Paths ---------------------------------------------------------------

export function pathLength(path: Path): number {
  return path.reduce((sum, s) => sum + segLength(s), 0)
}

/** Which segment a path fraction `t` falls on, and the fraction within it. */
function locate(path: Path, t: number): { index: number; u: number } {
  const total = pathLength(path)
  if (total === 0 || path.length === 0) return { index: 0, u: 0 }
  let remaining = clamp01(t) * total
  for (let i = 0; i < path.length; i++) {
    const len = segLength(path[i])
    if (remaining <= len || i === path.length - 1) return { index: i, u: len === 0 ? 0 : clamp01(remaining / len) }
    remaining -= len
  }
  return { index: path.length - 1, u: 1 }
}

export function pathStart(path: Path): PointMm {
  return segStart(path[0])
}

export function pathEnd(path: Path): PointMm {
  return segEnd(path[path.length - 1])
}

export function pathPointAt(path: Path, t: number): PointMm {
  const { index, u } = locate(path, t)
  return segPointAt(path[index], u)
}

export function pathTangentAt(path: Path, t: number): PointMm {
  const { index, u } = locate(path, t)
  return segTangentAt(path[index], u)
}

export function pathProject(path: Path, p: PointMm): { t: number; point: PointMm; dist: number } {
  const total = pathLength(path) || 1
  let before = 0
  let best = { t: 0, point: pathStart(path), dist: Infinity }
  for (const s of path) {
    const len = segLength(s)
    const hit = segProject(s, p)
    if (hit.dist < best.dist) best = { t: (before + hit.u * len) / total, point: hit.point, dist: hit.dist }
    before += len
  }
  return best
}

/** The part of a path between fractions `t0 < t1`. */
export function pathSlice(path: Path, t0: number, t1: number): Path {
  const total = pathLength(path)
  const out: Path = []
  let before = 0
  for (const s of path) {
    const len = segLength(s)
    const s0 = before / (total || 1)
    const s1 = (before + len) / (total || 1)
    before += len
    if (s1 <= t0 || s0 >= t1 || len === 0) continue
    const u0 = Math.max(0, (t0 - s0) / (s1 - s0))
    const u1 = Math.min(1, (t1 - s0) / (s1 - s0))
    if (u1 - u0 > 1e-9) out.push(segSlice(s, u0, u1))
  }
  return out
}

export function pathReverse(path: Path): Path {
  return [...path].reverse().map(segReverse)
}

/** Evenly spaced points along a path, ends included — for areas,
 * point-in-polygon tests and hit-testing, never for geometry itself. */
export function samplePath(path: Path, perArc = 16): PointMm[] {
  const out: PointMm[] = []
  for (const s of path) {
    const n = s.kind === 'line' ? 1 : Math.max(2, Math.ceil((Math.abs(s.sweep) / Math.PI) * perArc))
    for (let i = 0; i < n; i++) out.push(segPointAt(s, i / n))
  }
  if (path.length > 0) out.push(pathEnd(path))
  return out
}

// ---- Curves built from two points ---------------------------------------

/** A divider's own curve: straight for `sagMm === 0`, otherwise the
 * circular arc through `from` and `to` whose midpoint sits `sagMm` off
 * the chord — the same construction (and sign) arch bars always used, so
 * a converted bar keeps its exact shape. Positive sag bows toward
 * `(-dir.y, dir.x)` of the `from → to` direction. */
export function chordSagSeg(from: PointMm, to: PointMm, sagMm: number): Seg {
  const chord = dist(from, to)
  if (sagMm === 0 || chord === 0) return { kind: 'line', a: from, b: to }
  const s = Math.abs(sagMm)
  const r = (chord * chord) / (8 * s) + s / 2
  const dir = { x: (to.x - from.x) / chord, y: (to.y - from.y) / chord }
  const perp = { x: -dir.y, y: dir.x }
  const mid = lerp(from, to, 0.5)
  const sign = sagMm > 0 ? 1 : -1
  const c = { x: mid.x + perp.x * (sagMm - r * sign), y: mid.y + perp.y * (sagMm - r * sign) }
  const peak = { x: mid.x + perp.x * sagMm, y: mid.y + perp.y * sagMm }
  const a0 = Math.atan2(from.y - c.y, from.x - c.x)
  const aPeak = Math.atan2(peak.y - c.y, peak.x - c.x)
  return { kind: 'arc', c, r, a0, sweep: 2 * angleDiff(a0, aPeak) }
}

/** Inverse of `chordSagSeg`'s bow: the signed offset of `p` from the
 * chord, along the same perpendicular — what a midpoint-handle drag
 * turns into `sagMm`. */
export function sagFromPoint(from: PointMm, to: PointMm, p: PointMm): number {
  const chord = dist(from, to)
  if (chord === 0) return 0
  const dir = { x: (to.x - from.x) / chord, y: (to.y - from.y) / chord }
  const mid = lerp(from, to, 0.5)
  return (p.x - mid.x) * -dir.y + (p.y - mid.y) * dir.x
}

// ---- Intersections ---------------------------------------------------------
//
// Of the INFINITE carriers (a whole line, a whole circle) — callers that
// need the hit to be on the segment itself check the fractions.

export interface CarrierLine {
  kind: 'line'
  p: PointMm
  d: PointMm // unit direction
}
export interface CarrierCircle {
  kind: 'circle'
  c: PointMm
  r: number
}
export type Carrier = CarrierLine | CarrierCircle

export function carrierOf(s: Seg): Carrier {
  if (s.kind === 'arc') return { kind: 'circle', c: s.c, r: s.r }
  const len = dist(s.a, s.b) || 1
  return { kind: 'line', p: s.a, d: { x: (s.b.x - s.a.x) / len, y: (s.b.y - s.a.y) / len } }
}

export function intersectCarriers(a: Carrier, b: Carrier): PointMm[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const den = a.d.x * b.d.y - a.d.y * b.d.x
    if (Math.abs(den) < 1e-12) return []
    const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / den
    return [{ x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t }]
  }
  if (a.kind === 'circle' && b.kind === 'line') return intersectCarriers(b, a)
  if (a.kind === 'line' && b.kind === 'circle') {
    const fx = a.p.x - b.c.x
    const fy = a.p.y - b.c.y
    const bq = fx * a.d.x + fy * a.d.y
    const cq = fx * fx + fy * fy - b.r * b.r
    const disc = bq * bq - cq
    if (disc < -1e-9) return []
    const root = Math.sqrt(Math.max(disc, 0))
    const ts = root < 1e-9 ? [-bq] : [-bq - root, -bq + root]
    return ts.map((t) => ({ x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t }))
  }
  const ca = a as CarrierCircle
  const cb = b as CarrierCircle
  const d = dist(ca.c, cb.c)
  if (d < 1e-9 || d > ca.r + cb.r + 1e-9 || d < Math.abs(ca.r - cb.r) - 1e-9) return []
  const along = (ca.r * ca.r - cb.r * cb.r + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(ca.r * ca.r - along * along, 0))
  const mx = ca.c.x + ((cb.c.x - ca.c.x) * along) / d
  const my = ca.c.y + ((cb.c.y - ca.c.y) * along) / d
  if (h < 1e-9) return [{ x: mx, y: my }]
  const ox = (-(cb.c.y - ca.c.y) * h) / d
  const oy = ((cb.c.x - ca.c.x) * h) / d
  return [
    { x: mx + ox, y: my + oy },
    { x: mx - ox, y: my - oy },
  ]
}

/** Where two segments actually cross — each hit with its fraction along
 * both. Hits at or near an end are kept; callers drop the ones they
 * consider "touching", not "crossing". */
export function intersectSegs(a: Seg, b: Seg, toleranceMm = 1e-3): { p: PointMm; ua: number; ub: number }[] {
  const out: { p: PointMm; ua: number; ub: number }[] = []
  for (const p of intersectCarriers(carrierOf(a), carrierOf(b))) {
    const ha = segProject(a, p)
    const hb = segProject(b, p)
    if (ha.dist <= toleranceMm && hb.dist <= toleranceMm) out.push({ p, ua: ha.u, ub: hb.u })
  }
  return out
}

export function intersectPaths(a: Path, b: Path): { p: PointMm; ta: number; tb: number }[] {
  const out: { p: PointMm; ta: number; tb: number }[] = []
  const totalA = pathLength(a) || 1
  const totalB = pathLength(b) || 1
  let beforeA = 0
  for (const sa of a) {
    const lenA = segLength(sa)
    let beforeB = 0
    for (const sb of b) {
      const lenB = segLength(sb)
      for (const hit of intersectSegs(sa, sb)) {
        out.push({ p: hit.p, ta: (beforeA + hit.ua * lenA) / totalA, tb: (beforeB + hit.ub * lenB) / totalB })
      }
      beforeB += lenB
    }
    beforeA += lenA
  }
  return out
}

/** Signed area of a closed polygon (shoelace, screen coordinates). */
export function polygonArea(points: PointMm[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

export function pointInPolygon(p: PointMm, poly: PointMm[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** The point deepest inside a polygon and its distance to the nearest
 * edge — where a light's mark or letter goes when the light isn't a
 * rectangle (its bounding-box centre can sit on a divider or outside
 * the light). A coarse grid, then a finer one around the best cell. */
export function interiorPoint(poly: PointMm[]): { point: PointMm; radius: number } {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const w = Math.max(...xs) - x0
  const h = Math.max(...ys) - y0
  const edgeDist = (p: PointMm) => {
    let best = Infinity
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j]
      const b = poly[i]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy || 1
      const t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)))
    }
    return best
  }
  let point = { x: x0 + w / 2, y: y0 + h / 2 }
  let radius = pointInPolygon(point, poly) ? edgeDist(point) : -1
  let cx = point.x
  let cy = point.y
  let spanX = w
  let spanY = h
  for (let pass = 0; pass < 3; pass++) {
    const n = 16
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = { x: cx - spanX / 2 + (spanX * i) / n, y: cy - spanY / 2 + (spanY * j) / n }
        if (!pointInPolygon(p, poly)) continue
        const d = edgeDist(p)
        if (d > radius) {
          radius = d
          point = p
        }
      }
    }
    cx = point.x
    cy = point.y
    spanX /= 6
    spanY /= 6
  }
  return { point, radius: Math.max(radius, 0) }
}
