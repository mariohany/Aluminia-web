import type { HeadOutline, PointMm } from '@/lib/arch-geometry'
import {
  angleDiff,
  carrierOf,
  dist,
  intersectCarriers,
  pathLength,
  pathPointAt,
  pathProject,
  pathReverse,
  pathSlice,
  pointInPolygon,
  polygonArea,
  samplePath,
  segEnd,
  segLength,
  segPointAt,
  segStart,
  segTangentAt,
  type Carrier,
  type Path,
  type Seg,
} from '@/lib/curves'
import { allMembers, resolveDividers, type DividerLike, type FrameGeometry, type Member } from '@/lib/dividers'
import type { RectMm } from '@/lib/window-geometry'

// Lights: the closed areas the frame and its dividers make —
// docs/free_dividers_planing.md §4. Pure. Built as a planar graph of
// member centrelines (frame members are already the clear opening's
// edges); every face but the outside one is a light. Because every
// divider end lands on a member and the rect zone is square-only, no
// light has a reflex corner, which is what keeps every offset below
// exact rather than approximate.

/** One edge of a light's boundary, oriented around it, and the member
 * it belongs to. */
export interface LoopEdge {
  seg: Seg
  member: string
}

export interface Light {
  /** Sorted ids of the members around it, joined by `|` — the light's
   * identity (§4.2); survives every move that doesn't change topology. */
  key: string
  members: string[]
  /** Around the light along member centrelines. */
  boundary: LoopEdge[]
  /** The clear opening: every edge moved in by its member's half face.
   * `null` when the light is too small to have one (`lightTooSmall`). */
  clear: Seg[] | null
  /** Set when the clear opening is a plain rectangle (every rect-zone
   * light, Q2). */
  rect?: RectMm
  /** Set when the light is the whole arch over a full-width bottom —
   * the only arched light that may still open (Q7). */
  head?: HeadOutline
  zone: 'rect' | 'arch'
  /** Sampled clear outline (boundary when `clear` is null) — for areas,
   * hit-testing and ordering only. */
  polygon: PointMm[]
  bbox: RectMm
  area: number
}

export interface BandEnd {
  /** How far each side's saw cut is off square, 0–90° (Q10/Q19). Equal
   * for a plain end; different at a hub or against a curve. */
  leftDeg: number
  rightDeg: number
  /** What each side is cut against. */
  leftOn: string
  rightOn: string
}

export interface Band {
  dividerId: string
  outline: Seg[]
  lengthMm: number
  ends: [BandEnd, BandEnd]
}

export interface JunctionAngle {
  at: PointMm
  /** Screen angle of the first member's direction and the turn to the
   * second, clockwise on screen — what a label arc is drawn with. */
  start: number
  sweep: number
  deg: number
  members: [string, string]
}

export interface LightGraph {
  lights: Light[]
  bands: Band[]
  angles: JunctionAngle[]
}

const NODE_TOL = 0.05
const DEGENERATE_MM = 0.05

interface Node {
  id: number
  p: PointMm
  out: HalfEdge[]
}
interface HalfEdge {
  from: Node
  to: Node
  path: Path
  member: string
  twin?: HalfEdge
  angle: number
  tangentAngle: number
  next?: HalfEdge
  visited?: boolean
}

/**
 * The lights, divider bands and junction angles of one panel. `halfFace`
 * gives each divider's half face width (its own profile, else the
 * panel's default — Q12); frame members are already the clear opening's
 * edge, so they offset by nothing.
 */
export function buildLightGraph(geo: FrameGeometry, dividers: readonly DividerLike[], halfFace: (dividerId: string) => number): LightGraph {
  const resolved = resolveDividers(geo, dividers)
  const members = allMembers(geo, resolved)
  const half = (id: string) => (geo.members.has(id) ? 0 : halfFace(id))

  // Split points per member: its own ends plus every divider end landing
  // on it.
  const splits = new Map<string, number[]>()
  for (const id of members.keys()) splits.set(id, [0, 1])
  for (const r of resolved.values()) {
    for (const [anchor, point] of [
      [r.divider.from, r.from],
      [r.divider.to, r.to],
    ] as const) {
      const host = members.get(anchor.on)
      if (host) splits.get(host.id)!.push(pathProject(host.path, point).t)
    }
  }

  const nodes: Node[] = []
  const nodeAt = (p: PointMm): Node => {
    for (const n of nodes) if (dist(n.p, p) <= NODE_TOL) return n
    const n: Node = { id: nodes.length, p, out: [] }
    nodes.push(n)
    return n
  }

  for (const [id, m] of members) {
    const len = pathLength(m.path)
    const ts = [...new Set(splits.get(id))].sort((a, b) => a - b)
    const kept: number[] = []
    for (const t of ts) if (kept.length === 0 || (t - kept[kept.length - 1]) * len > 0.01) kept.push(t)
    if (kept[kept.length - 1] < 1) kept[kept.length - 1] = 1
    for (let i = 0; i + 1 < kept.length; i++) {
      const path = pathSlice(m.path, kept[i], kept[i + 1])
      if (path.length === 0 || pathLength(path) < 0.01) continue
      const a = nodeAt(pathPointAt(m.path, kept[i]))
      const b = nodeAt(pathPointAt(m.path, kept[i + 1]))
      if (a === b) continue
      const fwd = halfEdge(a, b, path, id)
      const back = halfEdge(b, a, pathReverse(path), id)
      fwd.twin = back
      back.twin = fwd
      a.out.push(fwd)
      b.out.push(back)
    }
  }
  for (const n of nodes) n.out.sort((x, y) => x.angle - y.angle)

  // Face tracing: arriving at a node, leave by the edge just before the
  // way back in angle order — keeps every inner face on the (algebraic)
  // left, so inner faces come out with positive area and the outside
  // with negative.
  for (const n of nodes) {
    for (const h of n.out) {
      const at = h.to
      const i = at.out.indexOf(h.twin!)
      h.next = at.out[(i - 1 + at.out.length) % at.out.length]
    }
  }

  const raw: { boundary: LoopEdge[]; area: number; nodes: Node[] }[] = []
  for (const n of nodes) {
    for (const start of n.out) {
      if (start.visited) continue
      const loop: HalfEdge[] = []
      let h: HalfEdge | undefined = start
      let guard = 0
      while (h && !h.visited && guard++ < 10000) {
        h.visited = true
        loop.push(h)
        h = h.next
      }
      const boundary = loop.flatMap((e) => e.path.map((seg) => ({ seg, member: e.member })))
      const area = polygonArea(samplePath(boundary.map((e) => e.seg)))
      raw.push({ boundary: mergeEdges(boundary), area, nodes: loop.map((e) => e.from) })
    }
  }

  const corners = new Map<string, CornerRecord[]>()
  const lights: Light[] = []
  for (const face of raw) {
    if (face.area <= 1) continue
    const ids = [...new Set(face.boundary.map((e) => e.member))].sort()
    const clear = insetLoop(face.boundary, (e) => half(e.member), (i, corner, carriers) => {
      const a = face.boundary[i]
      const b = face.boundary[(i + 1) % face.boundary.length]
      const record = (self: string, other: string, otherCarrier: Carrier) => {
        if (geo.members.has(self)) return
        const list = corners.get(self) ?? []
        list.push({ node: segEnd(a.seg), point: corner, other, otherCarrier })
        corners.set(self, list)
      }
      record(a.member, b.member, carriers[1])
      record(b.member, a.member, carriers[0])
    })
    const polygon = samplePath(clear ?? face.boundary.map((e) => e.seg))
    const bbox = bboxOf(polygon)
    const light: Light = {
      key: ids.join('|'),
      members: ids,
      boundary: face.boundary,
      clear,
      zone: geo.arched && bbox.y < geo.springY - 0.5 ? 'arch' : 'rect',
      polygon,
      bbox,
      area: Math.abs(polygonArea(polygon)),
    }
    if (clear && clear.length === 4 && clear.every(isAxisLine)) light.rect = bbox
    const head = wholeArch(geo, members, light, clear)
    if (head) light.head = head
    lights.push(light)
  }

  // Display order (§4.2): top to bottom, then left to right. Duplicate
  // keys (degenerate geometry only) get a suffix.
  lights.sort((a, b) => Math.round(a.bbox.y * 2) - Math.round(b.bbox.y * 2) || a.bbox.x - b.bbox.x)
  const seen = new Map<string, number>()
  for (const l of lights) {
    const n = (seen.get(l.key) ?? 0) + 1
    seen.set(l.key, n)
    if (n > 1) l.key = `${l.key}#${n}`
  }

  const bands: Band[] = []
  for (const r of resolved.values()) {
    const band = buildBand(r, half(r.id), corners.get(r.id) ?? [], members)
    if (band) bands.push(band)
  }

  return { lights, bands, angles: junctionAngles(nodes, geo) }
}

function halfEdge(from: Node, to: Node, path: Path, member: string): HalfEdge {
  // Direction a short way along the edge rather than the bare tangent, so
  // an arc and a line leaving a node on the same tangent still sort by
  // which way they curve.
  const len = pathLength(path)
  const near = pathPointAt(path, Math.min(0.5, len / 4) / (len || 1))
  const t = segTangentAt(path[0], 0)
  return { from, to, path, member, angle: Math.atan2(near.y - from.p.y, near.x - from.p.x), tangentAngle: Math.atan2(t.y, t.x) }
}

function sameCarrier(a: Seg, b: Seg): boolean {
  if (a.kind === 'line' && b.kind === 'line') {
    const ca = carrierOf(a) as Extract<Carrier, { kind: 'line' }>
    const cross = ca.d.x * (b.b.y - b.a.y) - ca.d.y * (b.b.x - b.a.x)
    const off = ca.d.x * (b.a.y - ca.p.y) - ca.d.y * (b.a.x - ca.p.x)
    return Math.abs(cross) < 1e-6 * segLength(b) && Math.abs(off) < 1e-6
  }
  if (a.kind === 'arc' && b.kind === 'arc') return dist(a.c, b.c) < 1e-6 && Math.abs(a.r - b.r) < 1e-6 && Math.sign(a.sweep) === Math.sign(b.sweep)
  return false
}

function joinSegs(a: Seg, b: Seg): Seg {
  if (a.kind === 'line' && b.kind === 'line') return { kind: 'line', a: a.a, b: b.b }
  const arc = a as Extract<Seg, { kind: 'arc' }>
  return { ...arc, sweep: arc.sweep + (b as Extract<Seg, { kind: 'arc' }>).sweep }
}

/** Joins neighbouring edges of the same member that continue each other
 * (a transom split by a stem on the far side is one straight edge of the
 * light on this side). */
function mergeEdges(edges: LoopEdge[]): LoopEdge[] {
  const out: LoopEdge[] = []
  for (const e of edges) {
    const last = out[out.length - 1]
    if (last && last.member === e.member && sameCarrier(last.seg, e.seg)) out[out.length - 1] = { member: e.member, seg: joinSegs(last.seg, e.seg) }
    else out.push(e)
  }
  while (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (last.member !== first.member || !sameCarrier(last.seg, first.seg)) break
    out[0] = { member: first.member, seg: joinSegs(last.seg, first.seg) }
    out.pop()
  }
  return out
}

function isAxisLine(s: Seg): boolean {
  return s.kind === 'line' && (Math.abs(s.a.x - s.b.x) < 1e-6 || Math.abs(s.a.y - s.b.y) < 1e-6)
}

function bboxOf(points: PointMm[]): RectMm {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** The whole-arch light (Q7's exception): the full, unsplit head over
 * one full-width horizontal bottom, plus the jambs if any of them show. */
function wholeArch(geo: FrameGeometry, members: Map<string, Member>, light: Light, clear: Seg[] | null): HeadOutline | undefined {
  if (!geo.arched || !clear || !light.members.includes('head')) return undefined
  const headEdges = light.boundary.filter((e) => e.member === 'head')
  const headLen = headEdges.reduce((s, e) => s + segLength(e.seg), 0)
  if (Math.abs(headLen - pathLength(geo.members.get('head')!.path)) > 0.5) return undefined
  const others = light.members.filter((m) => m !== 'head' && m !== 'left' && m !== 'right')
  if (others.length !== 1 || members.get(others[0])?.axis !== 'h') return undefined
  const bottom = Math.max(...light.polygon.map((p) => p.y))
  if (bottom < geo.springY - 0.5) return undefined
  return { rect: { ...geo.inner.rect, height: bottom - geo.inner.rect.y }, shape: geo.inner.shape, riseMm: geo.inner.riseMm }
}

// ---- Offsetting a loop ------------------------------------------------------

function offsetCarrier(seg: Seg, inward: PointMm, d: number): Carrier | null {
  const p = segStart(seg)
  if (seg.kind === 'line') {
    const c = carrierOf(seg) as Extract<Carrier, { kind: 'line' }>
    return { kind: 'line', p: { x: p.x + inward.x * d, y: p.y + inward.y * d }, d: c.d }
  }
  const moved = { x: p.x + inward.x * d, y: p.y + inward.y * d }
  const r = dist(seg.c, moved)
  return r < 1e-6 ? null : { kind: 'circle', c: seg.c, r }
}

function nearest(points: PointMm[], to: PointMm): PointMm | null {
  let best: PointMm | null = null
  for (const p of points) if (!best || dist(p, to) < dist(best, to)) best = p
  return best
}

/**
 * Moves every edge of a closed loop inward by its own distance — lines to
 * parallel lines, arcs to concentric arcs — and re-intersects
 * neighbours for the new corners. `null` if the loop collapses (an edge
 * turns round or vanishes). `onCorner` sees each corner with both
 * neighbours' offset carriers, which is how a divider band learns where
 * its end is cut (§4.4).
 */
export function insetLoop(
  loop: LoopEdge[] | Seg[],
  distance: (edge: LoopEdge, index: number) => number,
  onCorner?: (index: number, corner: PointMm, carriers: [Carrier, Carrier]) => void,
): Seg[] | null {
  const edges: LoopEdge[] = (loop as (LoopEdge | Seg)[]).map((e) => ('seg' in e ? e : { seg: e, member: '' }))
  const n = edges.length
  if (n < 2) return null
  const sign = polygonArea(samplePath(edges.map((e) => e.seg))) > 0 ? 1 : -1
  const inwardAt = (seg: Seg, u: number) => {
    const t = segTangentAt(seg, u)
    return { x: -t.y * sign, y: t.x * sign }
  }
  const carriers: (Carrier | null)[] = edges.map((e, i) => offsetCarrier(e.seg, inwardAt(e.seg, 0), distance(e, i)))
  if (carriers.some((c) => c === null)) return null

  const corners: PointMm[] = []
  for (let i = 0; i < n; i++) {
    const a = edges[i]
    const b = edges[(i + 1) % n]
    const vertex = segEnd(a.seg)
    const da = distance(a, i)
    const db = distance(b, (i + 1) % n)
    let corner: PointMm | null = da === 0 && db === 0 ? vertex : nearest(intersectCarriers(carriers[i]!, carriers[(i + 1) % n]!), vertex)
    if (!corner) {
      const na = inwardAt(a.seg, 1)
      corner = { x: vertex.x + na.x * da, y: vertex.y + na.y * da }
    }
    corners.push(corner)
    onCorner?.(i, corner, [carriers[i]!, carriers[(i + 1) % n]!])
  }

  // An edge can legitimately shrink to nothing — the half divider face of jamb
  // between the springing point and a transom whose top face sits on the
  // springing line — and is dropped; one that turns round is a collapse.
  const out: Seg[] = []
  for (let i = 0; i < n; i++) {
    const start = corners[(i - 1 + n) % n]
    const end = corners[i]
    const seg = edges[i].seg
    if (dist(start, end) < DEGENERATE_MM) continue
    if (seg.kind === 'line') {
      const dx = end.x - start.x
      const dy = end.y - start.y
      const ox = seg.b.x - seg.a.x
      const oy = seg.b.y - seg.a.y
      if (dx * ox + dy * oy <= 0) return null
      out.push({ kind: 'line', a: start, b: end })
    } else {
      const c = carriers[i] as Extract<Carrier, { kind: 'circle' }>
      const a0 = Math.atan2(start.y - seg.c.y, start.x - seg.c.x)
      const a1 = Math.atan2(end.y - seg.c.y, end.x - seg.c.x)
      const tau = Math.PI * 2
      const sweep = seg.sweep >= 0 ? (((a1 - a0) % tau) + tau) % tau : -((((a0 - a1) % tau) + tau) % tau)
      if (Math.abs(sweep) > Math.abs(seg.sweep) + Math.PI / 2) return null
      out.push({ kind: 'arc', c: seg.c, r: c.r, a0, sweep })
    }
  }
  if (out.length < 2) return null
  const area = polygonArea(samplePath(out))
  if (Math.sign(area) !== sign || Math.abs(area) < 1) return null
  return out
}

// ---- Divider bands (§4.4) ------------------------------------------------------

interface CornerRecord {
  node: PointMm
  point: PointMm
  other: string
  otherCarrier: Carrier
}

function cutDirection(c: Carrier, at: PointMm): PointMm {
  if (c.kind === 'line') return c.d
  const rx = at.x - c.c.x
  const ry = at.y - c.c.y
  const l = Math.hypot(rx, ry) || 1
  return { x: -ry / l, y: rx / l }
}

/** The line a side of a band end is sawn along. Against a member that
 * runs on through the junction, that member's face; at a hub, where the
 * neighbour ENDS at the same point, the mitre — the line from the corner
 * through the junction itself, i.e. the bisector of the two bars (Q19). */
function sideCut(rec: CornerRecord, members: Map<string, Member>): PointMm {
  const other = members.get(rec.other)
  const endsHere = other && !other.frame && (dist(pathPointAt(other.path, 0), rec.node) <= NODE_TOL || dist(pathPointAt(other.path, 1), rec.node) <= NODE_TOL)
  if (endsHere) return { x: rec.node.x - rec.point.x, y: rec.node.y - rec.point.y }
  return cutDirection(rec.otherCarrier, rec.point)
}

/** Degrees off square for a cut along `cut` across a bar running `dir`. */
function offSquare(dir: PointMm, cut: PointMm): number {
  const cos = Math.abs(dir.x * cut.x + dir.y * cut.y) / ((Math.hypot(dir.x, dir.y) || 1) * (Math.hypot(cut.x, cut.y) || 1))
  const between = (Math.acos(Math.min(cos, 1)) * 180) / Math.PI
  return Math.round((90 - between) * 10) / 10
}

function buildBand(r: Member & { from: PointMm; to: PointMm }, half: number, records: CornerRecord[], members: Map<string, Member>): Band | null {
  const seg = r.path[0]
  const ends: { left: CornerRecord | null; right: CornerRecord | null; dir: PointMm }[] = []
  for (const [node, u] of [
    [r.from, 0],
    [r.to, 1],
  ] as const) {
    const t = segTangentAt(seg, u)
    let left: CornerRecord | null = null
    let right: CornerRecord | null = null
    for (const rec of records) {
      if (dist(rec.node, node) > NODE_TOL) continue
      const side = t.x * (rec.point.y - node.y) - t.y * (rec.point.x - node.x)
      if (side < 0) left = rec
      else right = rec
    }
    ends.push({ left, right, dir: t })
  }
  const [e0, e1] = ends
  if (!e0.left || !e0.right || !e1.left || !e1.right) return null

  const side = (from: PointMm, to: PointMm): Seg => {
    if (seg.kind === 'line') return { kind: 'line', a: from, b: to }
    const a0 = Math.atan2(from.y - seg.c.y, from.x - seg.c.x)
    const a1 = Math.atan2(to.y - seg.c.y, to.x - seg.c.x)
    return { kind: 'arc', c: seg.c, r: dist(seg.c, from), a0, sweep: angleDiff(a0, a1) || seg.sweep }
  }
  const endCut = (a: CornerRecord, b: CornerRecord, outward: PointMm): Seg[] => {
    const tip = cutTip(a, b, outward, half, members)
    return tip ? [{ kind: 'line', a: a.point, b: tip }, { kind: 'line', a: tip, b: b.point }] : [{ kind: 'line', a: a.point, b: b.point }]
  }
  const back = { x: -e0.dir.x, y: -e0.dir.y }
  const outline: Seg[] = [side(e0.left.point, e1.left.point), ...endCut(e1.left, e1.right, e1.dir), side(e1.right.point, e0.right.point), ...endCut(e0.right, e0.left, back)]

  let lengthMm: number
  if (seg.kind === 'line') {
    const d = segTangentAt(seg, 0)
    const proj = outline.flatMap((s) => [segStart(s), segEnd(s)]).map((p) => p.x * d.x + p.y * d.y)
    lengthMm = Math.max(...proj) - Math.min(...proj)
  } else {
    lengthMm = Math.max(segLength(outline[0]), segLength(outline.find((s, i) => i > 0 && s.kind === 'arc') ?? outline[0]))
  }

  // Both sides cut against the same member is one straight saw cut —
  // corner to corner, which against a curve is the chord, not either
  // side's own tangent.
  const endOf = (e: (typeof ends)[number]): BandEnd => {
    const l = e.left!
    const rr = e.right!
    const same = l.other === rr.other
    const chord = { x: rr.point.x - l.point.x, y: rr.point.y - l.point.y }
    return {
      leftDeg: offSquare(e.dir, same ? chord : sideCut(l, members)),
      rightDeg: offSquare(e.dir, same ? chord : sideCut(rr, members)),
      leftOn: l.other,
      rightOn: rr.other,
    }
  }
  return { dividerId: r.id, outline, lengthMm: Math.round(lengthMm * 10) / 10, ends: [endOf(e0), endOf(e1)] }
}

/** Where an end's two cut lines meet, when they differ — the point of a
 * mitred end at a hub (Q19). `null` for a plain straight cut. */
function cutTip(a: CornerRecord, b: CornerRecord, outward: PointMm, half: number, members: Map<string, Member>): PointMm | null {
  if (a.other === b.other) return null
  const unitOf = (v: PointMm) => {
    const l = Math.hypot(v.x, v.y) || 1
    return { x: v.x / l, y: v.y / l }
  }
  const la = { kind: 'line' as const, p: a.point, d: unitOf(sideCut(a, members)) }
  const lb = { kind: 'line' as const, p: b.point, d: unitOf(sideCut(b, members)) }
  const [tip] = intersectCarriers(la, lb)
  if (!tip) return null
  const mid = { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 }
  const beyond = (tip.x - mid.x) * outward.x + (tip.y - mid.y) * outward.y
  if (beyond <= 1e-3 || dist(tip, mid) > half * 4) return null
  return tip
}

// ---- Junction angles (Q9) -------------------------------------------------------

function junctionAngles(nodes: Node[], geo: FrameGeometry): JunctionAngle[] {
  const out: JunctionAngle[] = []
  for (const n of nodes) {
    if (n.out.length < 2 || n.out.every((h) => geo.members.has(h.member))) continue
    const sorted = [...n.out].sort((a, b) => a.tangentAngle - b.tangentAngle)
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]
      const b = sorted[(i + 1) % sorted.length]
      if (a.member === b.member) continue
      if (geo.members.has(a.member) && geo.members.has(b.member)) continue
      const tau = Math.PI * 2
      const sweep = (((b.tangentAngle - a.tangentAngle) % tau) + tau) % tau
      if (sweep > Math.PI + 1e-6 || sweep < 1e-6) continue
      out.push({ at: n.p, start: a.tangentAngle, sweep, deg: Math.round(((sweep * 180) / Math.PI) * 10) / 10, members: [a.member, b.member] })
    }
  }
  return out
}

/** The angles worth a label: anything but 90° and a straight 180° (Q9),
 * and never against the arch curve itself — only between dividers and
 * the arch's base (Mario, 2026-10-05). The saw cuts against the head are
 * still kept for the report (bands). */
export function visibleAngles(angles: JunctionAngle[]): JunctionAngle[] {
  return angles.filter((a) => !a.members.includes('head') && Math.abs(a.deg - 90) > 0.05 && Math.abs(a.deg - 180) > 0.05)
}

// ---- Lights beside a divider, and matching lights across an edit ----------------

/** The lights on each side of a divider — the two choices of Q18's
 * delete dialog. Left is the left of its `from → to` direction. */
export function sidesOf(graph: LightGraph, geo: FrameGeometry, dividers: readonly DividerLike[], dividerId: string): { left: string[]; right: string[] } {
  const r = resolveDividers(geo, dividers).get(dividerId)
  const out = { left: [] as string[], right: [] as string[] }
  if (!r) return out
  for (const l of graph.lights) {
    if (!l.members.includes(dividerId)) continue
    const c = centroid(l.polygon)
    const hit = pathProject(r.path, c)
    const t = segTangentAt(r.path[0], hit.t)
    const side = t.x * (c.y - hit.point.y) - t.y * (c.x - hit.point.x)
    if (side < 0) out.left.push(l.key)
    else out.right.push(l.key)
  }
  return out
}

function centroid(points: PointMm[]): PointMm {
  const n = points.length || 1
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n }
}

/**
 * For each light after an edit, the light before it that it takes its
 * settings from (§5.3): the old light covering most of it, or — when it
 * covers several, as after a delete — one of `prefer` (the side the user
 * kept, Q18). `null` for a light nothing covered.
 */
export function matchLights(prev: Light[], next: Light[], prefer: ReadonlySet<string> = new Set()): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const l of next) {
    const counts = new Map<string, number>()
    const { x, y, width, height } = l.bbox
    for (let i = 1; i < 10; i++) {
      for (let j = 1; j < 10; j++) {
        const p = { x: x + (width * i) / 10, y: y + (height * j) / 10 }
        if (!pointInPolygon(p, l.polygon)) continue
        for (const old of prev) if (pointInPolygon(p, old.polygon)) counts.set(old.key, (counts.get(old.key) ?? 0) + 1)
      }
    }
    if (prev.some((o) => o.key === l.key)) {
      out.set(l.key, l.key)
      continue
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const preferred = ranked.find(([key]) => prefer.has(key))
    out.set(l.key, (preferred ?? ranked[0])?.[0] ?? null)
  }
  return out
}

/** An SVG path for a closed loop of segments. */
export function loopToSvgPath(loop: Seg[]): string {
  if (loop.length === 0) return ''
  const f = (n: number) => Math.round(n * 1000) / 1000
  const start = segStart(loop[0])
  let d = `M${f(start.x)},${f(start.y)}`
  for (const s of loop) {
    const e = segEnd(s)
    if (s.kind === 'line') d += ` L${f(e.x)},${f(e.y)}`
    else {
      // Split at the midpoint so no single SVG arc exceeds 180°.
      const m = segPointAt(s, 0.5)
      const flag = s.sweep > 0 ? 1 : 0
      d += ` A${f(s.r)},${f(s.r)} 0 0 ${flag} ${f(m.x)},${f(m.y)} A${f(s.r)},${f(s.r)} 0 0 ${flag} ${f(e.x)},${f(e.y)}`
    }
  }
  return `${d} Z`
}
