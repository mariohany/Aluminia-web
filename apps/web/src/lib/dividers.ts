import { HeadShape } from '@repo/types/windows'
import { headCircles, headPointAt, insetHeadOutline, normalizeHeadRise, type HeadOutline, type PointMm } from '@/lib/arch-geometry'
import {
  angleDiff,
  carrierOf,
  chordSagSeg,
  dist,
  intersectCarriers,
  intersectPaths,
  pathLength,
  pathPointAt,
  pathProject,
  pathTangentAt,
  sagFromPoint,
  segProject,
  type Path,
  type Seg,
} from '@/lib/curves'

// Dividers drawn freely inside a frame — docs/free_dividers_planing.md §3.
// Pure: no React, no lookups, no API. Every divider end names the member
// it lands on (a frame side or an earlier divider) and where along it,
// never a bare coordinate, so moving a member drags everything standing
// on it with no propagation code. light-graph.ts turns the result into
// lights; this file only knows members, anchors and edits.

/** The clear opening's own sides. `top` exists only on a flat head,
 * `head` only on an arched one. */
export type FrameMemberId = 'left' | 'right' | 'sill' | 'top' | 'head'
export const FRAME_MEMBER_IDS: readonly FrameMemberId[] = ['left', 'right', 'sill', 'top', 'head']

export function isFrameMember(id: string): id is FrameMemberId {
  return (FRAME_MEMBER_IDS as readonly string[]).includes(id)
}

/**
 * `at` means mm on a straight axis-aligned member — measured from the
 * panel's LEFT edge on a horizontal one, UP FROM ITS BOTTOM edge on a
 * vertical one, so a resize keeps every divider where it was (Q13) — and
 * a `0..1` fraction of length on the head (Q17) or on a slanted/curved
 * divider, which have no natural mm datum.
 */
export interface DividerAnchor {
  on: string
  at: number
}

export interface DividerLike {
  id: string
  from: DividerAnchor
  to: DividerAnchor
  /** `0` = straight; signed bow, the arch-bar convention (curves.ts's
   * `chordSagSeg`). */
  sagMm: number
}

export interface FrameSpec {
  widthMm: number
  heightMm: number
  headShape: HeadShape
  headRiseMm?: number | null
  /** Outer frame face — the clear opening is the frame inset by this. */
  frameFace: number
  /** A hinged door: the opening runs to the panel's real bottom edge. */
  doorSill: boolean
  /** Half the divider face: a springing transom's centreline sits this
   * far below the springing line (Q5), and whatever stands on it still
   * belongs to the arch zone. */
  springOffsetMm?: number
}

/** `h` = straight horizontal (anchors on it are x mm), `v` = straight
 * vertical (anchors are mm up from the bottom), `null` = anything else
 * (anchors are fractions). */
export type MemberAxis = 'h' | 'v' | null

export interface Member {
  id: string
  path: Path
  frame: boolean
  axis: MemberAxis
}

export interface ResolvedDivider extends Member {
  from: PointMm
  to: PointMm
  divider: DividerLike
}

export interface FrameGeometry {
  spec: FrameSpec
  /** The clear opening (frame inset by `frameFace`), as a head outline —
   * the arch maths in arch-geometry.ts reads it directly. */
  inner: HeadOutline
  arched: boolean
  /** Where the jambs meet the head; the top edge on a flat head. Above
   * it is the arch zone (docs/free_dividers_planing.md vocabulary). */
  springY: number
  bottomY: number
  members: Map<string, Member>
}

const EPS = 1e-6

export function frameGeometry(spec: FrameSpec): FrameGeometry {
  const width = Math.max(spec.widthMm, 1)
  const height = Math.max(spec.heightMm, 1)
  const arched = spec.headShape !== HeadShape.FLAT
  const rise = arched ? normalizeHeadRise(spec.headShape, width, spec.headRiseMm ?? 0, height, spec.doorSill ? undefined : spec.frameFace) : 0
  const outer: HeadOutline = { rect: { x: 0, y: 0, width, height }, shape: spec.headShape, riseMm: rise }
  const inset = insetHeadOutline(outer, spec.frameFace)
  const inner: HeadOutline = spec.doorSill ? { ...inset, rect: { ...inset.rect, height: height - inset.rect.y } } : inset

  const left = inner.rect.x
  const right = inner.rect.x + inner.rect.width
  const top = inner.rect.y
  const bottomY = inner.rect.y + inner.rect.height
  const springY = inner.rect.y + inner.riseMm

  const members = new Map<string, Member>()
  const line = (a: PointMm, b: PointMm): Path => [{ kind: 'line', a, b }]
  members.set('sill', { id: 'sill', frame: true, axis: 'h', path: line({ x: left, y: bottomY }, { x: right, y: bottomY }) })
  members.set('left', { id: 'left', frame: true, axis: 'v', path: line({ x: left, y: bottomY }, { x: left, y: springY }) })
  members.set('right', { id: 'right', frame: true, axis: 'v', path: line({ x: right, y: bottomY }, { x: right, y: springY }) })
  if (arched) members.set('head', { id: 'head', frame: true, axis: null, path: headPath(inner) })
  else members.set('top', { id: 'top', frame: true, axis: 'h', path: line({ x: left, y: top }, { x: right, y: top }) })

  return { spec: { ...spec, widthMm: width, heightMm: height }, inner, arched, springY, bottomY, members }
}

/** The head curve, left springing point → right, as exact arcs — two for
 * a gothic head, meeting at its apex. Same circles the frame is drawn on
 * (`headCircles`), so a divider landing on the head lands on the line
 * the user sees. */
function headPath(o: HeadOutline): Path {
  const springY = o.rect.y + o.riseMm
  const left = { x: o.rect.x, y: springY }
  const right = { x: o.rect.x + o.rect.width, y: springY }
  const circles = headCircles(o)
  const angle = (c: { cx: number; cy: number }, p: PointMm) => Math.atan2(p.y - c.cy, p.x - c.cx)
  if (circles.length === 2) {
    const apex = headPointAt(o, 0.5)
    const [cl, cr] = circles
    const a0 = angle(cl, left)
    const b0 = angle(cr, apex)
    return [
      { kind: 'arc', c: { x: cl.cx, y: cl.cy }, r: cl.r, a0, sweep: angleDiff(a0, angle(cl, apex)) },
      { kind: 'arc', c: { x: cr.cx, y: cr.cy }, r: cr.r, a0: b0, sweep: angleDiff(b0, angle(cr, right)) },
    ]
  }
  const [c] = circles
  if (!c) return [{ kind: 'line', a: left, b: right }]
  const a0 = angle(c, left)
  const aTop = -Math.PI / 2
  return [{ kind: 'arc', c: { x: c.cx, y: c.cy }, r: c.r, a0, sweep: angleDiff(a0, aTop) + angleDiff(aTop, angle(c, right)) }]
}

// ---- Anchors -------------------------------------------------------------

function axisOf(path: Path): MemberAxis {
  if (path.length !== 1 || path[0].kind !== 'line') return null
  const { a, b } = path[0]
  if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS) return 'v'
  if (Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS) return 'h'
  return null
}

/** The point an anchor names on `member`. Mm anchors are clamped onto
 * the member rather than failing: a transiently out-of-range value mid
 * edit must never crash a render. */
export function pointOnMember(geo: FrameGeometry, member: Member, at: number): PointMm {
  if (member.axis === 'h' || member.axis === 'v') {
    const seg = member.path[0] as Extract<Seg, { kind: 'line' }>
    if (member.axis === 'h') {
      const lo = Math.min(seg.a.x, seg.b.x)
      const hi = Math.max(seg.a.x, seg.b.x)
      return { x: Math.min(Math.max(at, lo), hi), y: seg.a.y }
    }
    const lo = Math.min(seg.a.y, seg.b.y)
    const hi = Math.max(seg.a.y, seg.b.y)
    return { x: seg.a.x, y: Math.min(Math.max(geo.spec.heightMm - at, lo), hi) }
  }
  return pathPointAt(member.path, at)
}

/** The anchor `at` for a point on `member` — the inverse of
 * `pointOnMember`. */
export function anchorOn(geo: FrameGeometry, member: Member, p: PointMm): DividerAnchor {
  if (member.axis === 'h') return { on: member.id, at: p.x }
  if (member.axis === 'v') return { on: member.id, at: geo.spec.heightMm - p.y }
  return { on: member.id, at: pathProject(member.path, p).t }
}

const MAX_DEPTH = 64

/**
 * Every divider resolved to points and a path, in array order. A divider
 * whose anchor names a missing member (mid-delete, bad data) or a cycle
 * is simply absent from the map — callers skip it rather than crash.
 */
export function resolveDividers(geo: FrameGeometry, dividers: readonly DividerLike[]): Map<string, ResolvedDivider> {
  const byId = new Map(dividers.map((d) => [d.id, d]))
  const done = new Map<string, ResolvedDivider | null>()

  const memberFor = (id: string, visiting: Set<string>): Member | null => {
    const frame = geo.members.get(id)
    if (frame) return frame
    return resolveOne(id, visiting)
  }

  const resolveOne = (id: string, visiting: Set<string>): ResolvedDivider | null => {
    if (done.has(id)) return done.get(id) ?? null
    const divider = byId.get(id)
    if (!divider || visiting.has(id) || visiting.size > MAX_DEPTH) return null
    const next = new Set(visiting).add(id)
    const fromHost = memberFor(divider.from.on, next)
    const toHost = memberFor(divider.to.on, next)
    if (!fromHost || !toHost) {
      done.set(id, null)
      return null
    }
    const from = pointOnMember(geo, fromHost, divider.from.at)
    const to = pointOnMember(geo, toHost, divider.to.at)
    if (dist(from, to) < 0.5) {
      done.set(id, null)
      return null
    }
    const path: Path = [chordSagSeg(from, to, divider.sagMm)]
    const resolved: ResolvedDivider = { id, path, frame: false, axis: axisOf(path), from, to, divider }
    done.set(id, resolved)
    return resolved
  }

  const out = new Map<string, ResolvedDivider>()
  for (const d of dividers) {
    const r = resolveOne(d.id, new Set())
    if (r) out.set(d.id, r)
  }
  return out
}

/** Frame members and resolved dividers in one lookup. */
export function allMembers(geo: FrameGeometry, resolved: Map<string, ResolvedDivider>): Map<string, Member> {
  const out = new Map<string, Member>(geo.members)
  for (const [id, r] of resolved) out.set(id, r)
  return out
}

/** Where a resolved divider sits: any part below the springing line puts
 * it in the rect zone, which only allows straight vertical/horizontal
 * dividers (Q2). A springing transom's own centreline counts as on the
 * line, so a spoke standing on it is still an arch divider. */
export function zoneOf(geo: FrameGeometry, r: Member): 'rect' | 'arch' {
  if (!geo.arched) return 'rect'
  const limit = geo.springY + (geo.spec.springOffsetMm ?? 0) + 0.5
  const ys = [pathPointAt(r.path, 0).y, pathPointAt(r.path, 0.5).y, pathPointAt(r.path, 1).y]
  return ys.some((y) => y > limit) ? 'rect' : 'arch'
}

// ---- Ordering ------------------------------------------------------------

function hostsOf(d: DividerLike): string[] {
  return [d.from.on, d.to.on].filter((on) => !isFrameMember(on))
}

/** Topological order: every divider after the dividers it lands on — the
 * acyclicity rule the contract checks (§1). Stable: an already valid
 * array comes back unchanged. A cycle returns `null`. */
export function sortDividers<T extends DividerLike>(dividers: readonly T[]): T[] | null {
  const ids = new Set(dividers.map((d) => d.id))
  const placed = new Set<string>()
  const out: T[] = []
  let remaining = [...dividers]
  while (remaining.length > 0) {
    const next = remaining.findIndex((d) => hostsOf(d).every((h) => placed.has(h) || !ids.has(h)))
    if (next < 0) return null
    out.push(remaining[next])
    placed.add(remaining[next].id)
    remaining = remaining.filter((_, i) => i !== next)
  }
  return out
}

/** Every divider standing on `id`, directly or through a chain. */
export function dependentsOf(id: string, dividers: readonly DividerLike[]): Set<string> {
  const out = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const d of dividers) {
      if (d.id === id || out.has(d.id)) continue
      if (hostsOf(d).some((h) => h === id || out.has(h))) {
        out.add(d.id)
        changed = true
      }
    }
  }
  return out
}

/** A fresh id `<base><letter>` not already used. */
export function pieceId(base: string, taken: Set<string>): string {
  for (let i = 0; i < 26 * 26; i++) {
    const letters = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(97 + Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26))
    const id = `${base}${letters}`
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
  }
  const id = `${base}-${taken.size}`
  taken.add(id)
  return id
}

/** The signed bow of the part of `seg` between two of its own points. */
function subSag(seg: Seg, p0: PointMm, p1: PointMm): number {
  if (seg.kind === 'line') return 0
  const u0 = segProject(seg, p0).u
  const u1 = segProject(seg, p1).u
  const mid = { x: seg.c.x + seg.r * Math.cos(seg.a0 + seg.sweep * ((u0 + u1) / 2)), y: seg.c.y + seg.r * Math.sin(seg.a0 + seg.sweep * ((u0 + u1) / 2)) }
  return Math.round(sagFromPoint(p0, p1, mid))
}

// ---- Crossings (Q3) ------------------------------------------------------

/**
 * Splits divider `id` wherever it crosses another divider's interior:
 * the existing one runs through, and `id` becomes pieces `<id>a`,
 * `<id>b`, … each landing on what it crosses. Ends that already land on
 * a member are not crossings. Returns the array re-sorted.
 */
export function splitAtCrossings<T extends DividerLike>(geo: FrameGeometry, dividers: readonly T[], id: string): T[] {
  const resolved = resolveDividers(geo, dividers)
  const target = resolved.get(id)
  if (!target) return [...dividers]
  const len = pathLength(target.path)
  const cuts: { t: number; p: PointMm; host: Member }[] = []
  for (const [otherId, other] of resolved) {
    if (otherId === id) continue
    const otherLen = pathLength(other.path)
    for (const hit of intersectPaths(target.path, other.path)) {
      const fromEnd = Math.min(hit.ta, 1 - hit.ta) * len
      const fromOtherEnd = Math.min(hit.tb, 1 - hit.tb) * otherLen
      if (fromEnd > 0.5 && fromOtherEnd > 0.5) cuts.push({ t: hit.ta, p: hit.p, host: other })
    }
  }
  if (cuts.length === 0) return [...dividers]
  cuts.sort((a, b) => a.t - b.t)

  const original = target.divider as T
  const taken = new Set(dividers.map((d) => d.id))
  taken.delete(id)
  const seg = target.path[0]
  const pieces: T[] = []
  let fromAnchor = original.from
  let fromPoint = target.from
  for (const cut of cuts) {
    const toAnchor = anchorOn(geo, cut.host, cut.p)
    pieces.push({ ...original, id: pieceId(id, taken), from: fromAnchor, to: toAnchor, sagMm: subSag(seg, fromPoint, cut.p) })
    fromAnchor = toAnchor
    fromPoint = cut.p
  }
  pieces.push({ ...original, id: pieceId(id, taken), from: fromAnchor, to: original.to, sagMm: subSag(seg, fromPoint, target.to) })

  const rest = dividers.filter((d) => d.id !== id)
  const index = dividers.findIndex((d) => d.id === id)
  const next = [...rest.slice(0, index), ...pieces, ...rest.slice(index)]
  return sortDividers(next) ?? next
}

/** Re-anchors every end standing on one of `oldIds` onto whichever of
 * `newIds` now holds its point. */
function reanchorOnto<T extends DividerLike>(geo: FrameGeometry, dividers: T[], oldResolved: Map<string, ResolvedDivider>, oldIds: Set<string>, newIds: string[]): T[] {
  const newResolved = resolveDividers(geo, dividers)
  const targets = newIds.map((i) => newResolved.get(i)).filter((m): m is ResolvedDivider => !!m)
  return dividers.map((d) => {
    let changed = d
    for (const end of ['from', 'to'] as const) {
      const anchor = changed[end]
      if (!oldIds.has(anchor.on)) continue
      const host = oldResolved.get(anchor.on)
      if (!host) continue
      const p = pointOnMember(geo, host, anchor.at)
      let best: ResolvedDivider | null = null
      let bestDist = Infinity
      for (const t of targets) {
        if (t.id === d.id) continue
        const hit = pathProject(t.path, p)
        if (hit.dist < bestDist) {
          bestDist = hit.dist
          best = t
        }
      }
      if (best) changed = { ...changed, [end]: anchorOn(geo, best, p) }
    }
    return changed
  })
}

/**
 * Flips which member runs through a cross (Q3's swap button): pieces
 * `pieceA` (ending on `throughId`) and `pieceB` (starting on it, at the
 * same point) merge into one through member, and `throughId` is cut in
 * two there instead. Anything standing on the old members is re-anchored
 * onto the new ones. `null` if the three don't form a cross.
 */
export function swapCrossing<T extends DividerLike>(geo: FrameGeometry, dividers: readonly T[], throughId: string, pieceAId: string, pieceBId: string): T[] | null {
  const resolved = resolveDividers(geo, dividers)
  const through = resolved.get(throughId)
  const a = resolved.get(pieceAId)
  const b = resolved.get(pieceBId)
  if (!through || !a || !b) return null

  // Orient so A runs (outer end) → cross and B runs cross → (outer end).
  const aEnd = a.divider.to.on === throughId ? 'to' : a.divider.from.on === throughId ? 'from' : null
  const bEnd = b.divider.from.on === throughId ? 'from' : b.divider.to.on === throughId ? 'to' : null
  if (!aEnd || !bEnd) return null
  const cross = aEnd === 'to' ? a.to : a.from
  const crossB = bEnd === 'from' ? b.from : b.to
  if (dist(cross, crossB) > 0.5) return null
  const outerA = aEnd === 'to' ? a.divider.from : a.divider.to
  const outerAPoint = aEnd === 'to' ? a.from : a.to
  const outerB = bEnd === 'from' ? b.divider.to : b.divider.from
  const outerBPoint = bEnd === 'from' ? b.to : b.from

  const taken = new Set(dividers.map((d) => d.id))
  const mergedId = commonBase(pieceAId, pieceBId, taken)
  const aSeg = a.path[0]
  const mergedSag = aSeg.kind === 'arc' ? Math.round(sagOnCircle(aSeg, outerAPoint, outerBPoint, a.divider.sagMm)) : 0
  const merged = { ...(a.divider as T), id: mergedId, from: outerA, to: outerB, sagMm: mergedSag }

  // The merged member must exist before the old through member can be cut
  // onto it.
  const withMerged = [...dividers.filter((d) => d.id !== pieceAId && d.id !== pieceBId), merged]
  const mergedResolved = resolveDividers(geo, withMerged).get(mergedId)
  if (!mergedResolved) return null
  const onMerged = anchorOn(geo, mergedResolved, cross)
  const throughDiv = through.divider as T
  const tSeg = through.path[0]
  taken.delete(throughId)
  const t1 = { ...throughDiv, id: pieceId(throughId, taken), from: throughDiv.from, to: onMerged, sagMm: subSag(tSeg, through.from, cross) }
  const t2 = { ...throughDiv, id: pieceId(throughId, taken), from: onMerged, to: throughDiv.to, sagMm: subSag(tSeg, cross, through.to) }
  let next: T[] = [...withMerged.filter((d) => d.id !== throughId), t1, t2]
  next = reanchorOnto(geo, next, resolved, new Set([throughId]), [t1.id, t2.id])
  next = reanchorOnto(geo, next, resolved, new Set([pieceAId, pieceBId]), [mergedId])
  return sortDividers(next)
}

export interface Crossing {
  /** The member running through. */
  throughId: string
  /** The two pieces standing on it from opposite sides, in line. */
  pieceAId: string
  pieceBId: string
  point: PointMm
}

/** Every cross in the panel — the ⇄ swap button's places (Q3). Two
 * pieces ending on the same member at the same point and continuing
 * each other's line (or curve tangent) across it. */
export function findCrossings(geo: FrameGeometry, dividers: readonly DividerLike[]): Crossing[] {
  const resolved = resolveDividers(geo, dividers)
  const ends: { id: string; on: string; point: PointMm; away: PointMm }[] = []
  for (const r of resolved.values()) {
    for (const end of ['from', 'to'] as const) {
      const on = r.divider[end].on
      if (isFrameMember(on)) continue
      const t = pathTangentAt(r.path, end === 'from' ? 0 : 1)
      const away = end === 'from' ? t : { x: -t.x, y: -t.y }
      ends.push({ id: r.id, on, point: end === 'from' ? r.from : r.to, away })
    }
  }
  const out: Crossing[] = []
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]
      const b = ends[j]
      if (a.on !== b.on || a.id === b.id || dist(a.point, b.point) > 0.5) continue
      if (a.away.x * b.away.x + a.away.y * b.away.y > -0.98) continue
      out.push({ throughId: a.on, pieceAId: a.id, pieceBId: b.id, point: a.point })
    }
  }
  return out
}

function commonBase(a: string, b: string, taken: Set<string>): string {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const base = a.slice(0, i)
  if (base.length > 0 && !taken.has(base)) {
    taken.add(base)
    return base
  }
  return a
}

/** The bow of the arc on `seg`'s circle from `p0` to `p1`, keeping the
 * sign the piece had. */
function sagOnCircle(seg: Extract<Seg, { kind: 'arc' }>, p0: PointMm, p1: PointMm, signFrom: number): number {
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
  const d = dist(mid, seg.c)
  return Math.sign(signFrom || 1) * Math.max(seg.r - d, 0)
}

// ---- Ray casting -----------------------------------------------------------

export interface RayHit {
  memberId: string
  point: PointMm
  distance: number
}

/** Every member a ray from `origin` along unit `dir` meets, nearest
 * first. Hits closer than 0.5 mm (the start itself) are dropped. */
export function castRay(members: Map<string, Member>, origin: PointMm, dir: PointMm, exclude: Set<string> = new Set()): RayHit[] {
  const hits: RayHit[] = []
  for (const [id, m] of members) {
    if (exclude.has(id)) continue
    for (const seg of m.path) {
      for (const p of intersectCarriers({ kind: 'line', p: origin, d: dir }, carrierOf(seg))) {
        const along = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y
        if (along < 0.5) continue
        if (segProject(seg, p).dist > 1e-3) continue
        hits.push({ memberId: id, point: p, distance: along })
      }
    }
  }
  return hits.sort((a, b) => a.distance - b.distance)
}

function unit(a: PointMm, b: PointMm): PointMm {
  const l = dist(a, b) || 1
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}

// ---- Delete (Q11) -----------------------------------------------------------

/** What deleting `ids` touches: the dividers standing on them (directly),
 * for the confirmation's "Delete all / Extend the rest" question. */
export function planDelete(dividers: readonly DividerLike[], ids: readonly string[]): { dependents: string[] } {
  const doomed = new Set(ids)
  return { dependents: dividers.filter((d) => !doomed.has(d.id) && hostsOf(d).some((h) => doomed.has(h))).map((d) => d.id) }
}

/**
 * Deletes `ids`. `'delete'` takes every divider standing on them too,
 * transitively. `'extend'` first rejoins pieces that only existed because
 * of a deleted member (a transom cut by a deleted mullion becomes one
 * transom again), then grows each remaining stem along its own line to
 * the next member behind; a curved stem, or one with nothing to reach, is
 * deleted and its own dependents handled the same way.
 */
export function applyDelete<T extends DividerLike>(geo: FrameGeometry, dividers: readonly T[], ids: readonly string[], mode: 'delete' | 'extend'): T[] {
  if (mode === 'delete') {
    const doomed = new Set(ids)
    for (const id of ids) for (const dep of dependentsOf(id, dividers)) doomed.add(dep)
    return dividers.filter((d) => !doomed.has(d.id))
  }

  const removed = new Set(ids)
  let list: T[] = [...dividers]
  const oldResolved = resolveDividers(geo, dividers)

  // Rejoin collinear pieces meeting on a removed member from both sides.
  let merged = true
  while (merged) {
    merged = false
    outer: for (const a of list) {
      if (removed.has(a.id)) continue
      const ra = oldResolved.get(a.id)
      if (!ra || a.sagMm !== 0) continue
      for (const b of list) {
        if (b.id === a.id || removed.has(b.id) || b.sagMm !== 0) continue
        const rb = oldResolved.get(b.id)
        if (!rb) continue
        const shared = sharedRemovedEnd(a, b, ra, rb, removed)
        if (!shared) continue
        const join = { ...a, from: shared.outerA, to: shared.outerB, sagMm: 0 }
        list = list.filter((d) => d.id !== b.id).map((d) => (d.id === a.id ? join : d))
        list = list.map((d) => ({ ...d, from: d.from.on === b.id ? { ...d.from, on: a.id } : d.from, to: d.to.on === b.id ? { ...d.to, on: a.id } : d.to }))
        merged = true
        break outer
      }
    }
  }

  // Extend the remaining stems.
  let queue = list.filter((d) => !removed.has(d.id) && hostsOf(d).some((h) => removed.has(h))).map((d) => d.id)
  while (queue.length > 0) {
    const id = queue.shift() as string
    const d = list.find((x) => x.id === id)
    if (!d || removed.has(id)) continue
    const current = resolveDividers(geo, list)
    const self = oldResolved.get(id) ?? current.get(id)
    let next: T | null = d
    if (!self || d.sagMm !== 0) next = null
    for (const end of ['from', 'to'] as const) {
      if (!next || !removed.has(next[end].on)) continue
      const endPoint = end === 'from' ? self!.from : self!.to
      const otherPoint = end === 'from' ? self!.to : self!.from
      const dir = unit(otherPoint, endPoint)
      const members = allMembers(geo, current)
      const exclude = new Set([...removed, id])
      const hit = castRay(members, otherPoint, dir, exclude).find((h) => h.distance > dist(otherPoint, endPoint) - 0.5)
      next = hit ? { ...next, [end]: anchorOn(geo, members.get(hit.memberId)!, hit.point) } : null
    }
    if (next) {
      list = list.map((x) => (x.id === id ? (next as T) : x))
    } else {
      removed.add(id)
      queue = [...queue, ...list.filter((x) => !removed.has(x.id) && hostsOf(x).includes(id)).map((x) => x.id)]
    }
  }

  const kept = list.filter((d) => !removed.has(d.id))
  return sortDividers(kept) ?? applyDelete(geo, dividers, ids, 'delete')
}

function sharedRemovedEnd(a: DividerLike, b: DividerLike, ra: ResolvedDivider, rb: ResolvedDivider, removed: Set<string>): { outerA: DividerAnchor; outerB: DividerAnchor } | null {
  for (const ea of ['from', 'to'] as const) {
    if (!removed.has(a[ea].on)) continue
    for (const eb of ['from', 'to'] as const) {
      if (b[eb].on !== a[ea].on) continue
      const pa = ea === 'from' ? ra.from : ra.to
      const pb = eb === 'from' ? rb.from : rb.to
      if (dist(pa, pb) > 0.5) continue
      const da = unit(ea === 'from' ? ra.to : ra.from, pa)
      const db = unit(pb, eb === 'from' ? rb.to : rb.from)
      if (da.x * db.x + da.y * db.y < 1 - 1e-6) continue // not collinear and continuing
      return { outerA: ea === 'from' ? a.to : a.from, outerB: eb === 'from' ? b.to : b.from }
    }
  }
  return null
}

// ---- Moving, bending, stretching ------------------------------------------

/**
 * Moves a straight vertical/horizontal divider to `mm` — from the left
 * edge for a mullion, up from the bottom edge for a transom (Q15). Its
 * ends slide along their hosts; whatever stands on it follows by
 * construction. With `isValid`, a target that fails is pulled back to the
 * farthest valid position between the current one and it.
 */
export function moveStraight<T extends DividerLike>(geo: FrameGeometry, dividers: readonly T[], id: string, mm: number, isValid?: (next: T[]) => boolean): T[] {
  const resolved = resolveDividers(geo, dividers)
  const self = resolved.get(id)
  if (!self || (self.axis !== 'h' && self.axis !== 'v')) return [...dividers]
  const members = allMembers(geo, resolved)
  const current = self.axis === 'v' ? self.from.x : geo.spec.heightMm - self.from.y

  const at = (value: number): T[] | null => {
    const line =
      self.axis === 'v'
        ? { kind: 'line' as const, p: { x: value, y: 0 }, d: { x: 0, y: 1 } }
        : { kind: 'line' as const, p: { x: 0, y: geo.spec.heightMm - value }, d: { x: 1, y: 0 } }
    const updated = { ...self.divider } as T
    for (const end of ['from', 'to'] as const) {
      const host = members.get(self.divider[end].on)
      if (!host) return null
      const near = end === 'from' ? self.from : self.to
      let best: PointMm | null = null
      for (const seg of host.path) {
        for (const p of intersectCarriers(line, carrierOf(seg))) {
          if (segProject(seg, p).dist > 1e-3) continue
          if (!best || dist(p, near) < dist(best, near)) best = p
        }
      }
      if (!best) return null
      updated[end] = anchorOn(geo, host, best)
    }
    return dividers.map((d) => (d.id === id ? updated : d))
  }

  const target = at(mm)
  if (target && (!isValid || isValid(target))) return target
  if (!isValid) return [...dividers]
  let lo = current
  let hi = mm
  let best: T[] = [...dividers]
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const candidate = at(mid)
    if (candidate && isValid(candidate)) {
      best = candidate
      lo = mid
    } else hi = mid
  }
  return best
}

export function moveEnd<T extends DividerLike>(dividers: readonly T[], id: string, end: 'from' | 'to', anchor: DividerAnchor): T[] {
  return dividers.map((d) => (d.id === id ? { ...d, [end]: anchor } : d))
}

export function bendDivider<T extends DividerLike>(dividers: readonly T[], id: string, sagMm: number): T[] {
  return dividers.map((d) => (d.id === id ? { ...d, sagMm: Math.round(sagMm) } : d))
}

/**
 * Inserts `deltaMm` of length into the panel at `lineMm` along `axis` —
 * the one primitive behind panel resize (line at the far edge: only the
 * right/top lights grow, Q13), a light's own size (line at its far edge,
 * Q14) and "+" (Q20). Every mm anchor beyond the line shifts; head
 * fractions don't (Q17). `x` is measured from the left, `y` up from the
 * bottom, matching the anchors themselves. The caller changes the
 * panel's own width/height.
 */
export function stretchPanel<T extends DividerLike>(geo: FrameGeometry, dividers: readonly T[], axis: 'x' | 'y', lineMm: number, deltaMm: number): T[] {
  const members = allMembers(geo, resolveDividers(geo, dividers))
  const shift = (anchor: DividerAnchor): DividerAnchor => {
    const host = members.get(anchor.on)
    const carriesX = host?.axis === 'h'
    const carriesY = host?.axis === 'v'
    if ((axis === 'x' && carriesX) || (axis === 'y' && carriesY)) {
      return anchor.at > lineMm ? { ...anchor, at: anchor.at + deltaMm } : anchor
    }
    return anchor
  }
  return dividers.map((d) => ({ ...d, from: shift(d.from), to: shift(d.to) }))
}

// ---- Drawing: where a click lands and where the shadow line goes ----------

export interface SnapHit {
  anchor: DividerAnchor
  memberId: string
  point: PointMm
  kind: 'end' | 'stop' | 'springing' | 'member'
}

const STOPS = [0.5, 1 / 3, 2 / 3]

/**
 * What a click at `p` lands on, in priority order: an existing divider
 * end; a ½ ⅓ ⅔ stop on any member; the springing height on a jamb (Q5 —
 * `springOffsetMm` below the springing point, so a transom drawn there
 * has its top face on the springing line, today's convention); any point
 * on a member. `null` over open glass.
 */
export function snapStart(geo: FrameGeometry, resolved: Map<string, ResolvedDivider>, p: PointMm, toleranceMm: number, springOffsetMm: number): SnapHit | null {
  const members = allMembers(geo, resolved)
  let best: SnapHit | null = null
  let bestDist = toleranceMm
  const consider = (hit: SnapHit) => {
    const d = dist(p, hit.point)
    if (d <= bestDist) {
      bestDist = d
      best = hit
    }
  }

  for (const r of resolved.values()) {
    for (const end of ['from', 'to'] as const) {
      consider({ anchor: r.divider[end], memberId: r.divider[end].on, point: end === 'from' ? r.from : r.to, kind: 'end' })
    }
  }
  if (best) return best

  for (const m of members.values()) {
    for (const t of STOPS) {
      const point = pathPointAt(m.path, t)
      consider({ anchor: anchorOn(geo, m, point), memberId: m.id, point, kind: 'stop' })
    }
  }
  if (geo.arched) {
    for (const id of ['left', 'right']) {
      const m = geo.members.get(id)
      if (!m) continue
      const point = { x: pathPointAt(m.path, 0).x, y: geo.springY + springOffsetMm }
      consider({ anchor: anchorOn(geo, m, point), memberId: id, point, kind: 'springing' })
    }
  }
  if (best) return best

  for (const m of members.values()) {
    const hit = pathProject(m.path, p)
    consider({ anchor: anchorOn(geo, m, hit.point), memberId: m.id, point: hit.point, kind: 'member' })
  }
  return best
}

export interface Aim {
  zone: 'rect' | 'arch'
  dir: PointMm
  /** Angle against the start member's tangent, whole degrees (Q9b); 90
   * in the rect zone. */
  angleDeg: number
  hits: RayHit[]
}

/**
 * Where the shadow line from `start` toward `pointer` goes. Below the
 * springing line it is locked square to the start member (Q2); above it,
 * its angle against the start member snaps to whole degrees (Q9b). The
 * ray runs to every member it meets — the caller offers the first one,
 * or a later one once the pointer is past it (drawing across).
 * `springOffsetMm` is the same half face `snapStart` uses for the
 * springing transom.
 */
export function aimFrom(geo: FrameGeometry, resolved: Map<string, ResolvedDivider>, start: SnapHit, pointer: PointMm, springOffsetMm: number): Aim | null {
  const members = allMembers(geo, resolved)
  const host = members.get(start.memberId)
  if (!host) return null
  const v = { x: pointer.x - start.point.x, y: pointer.y - start.point.y }
  if (Math.hypot(v.x, v.y) < 1) return null
  // A start no lower than a springing transom's centreline can aim into
  // the arch freely; anything lower is a mullion rising into it (Q2).
  const zone: 'rect' | 'arch' = geo.arched && pointer.y < geo.springY - EPS && start.point.y <= geo.springY + springOffsetMm + 1 ? 'arch' : 'rect'

  let dir: PointMm
  let angleDeg = 90
  if (zone === 'rect') {
    dir = host.axis === 'v' ? { x: Math.sign(v.x) || 1, y: 0 } : { x: 0, y: Math.sign(v.y) || 1 }
    if (host.axis === null && start.point.y < geo.springY + 1) dir = { x: 0, y: 1 }
  } else {
    const t = pathTangentAt(host.path, pathProject(host.path, start.point).t)
    const vl = Math.hypot(v.x, v.y)
    const cos = (t.x * v.x + t.y * v.y) / vl
    angleDeg = Math.min(Math.max(Math.round((Math.acos(Math.min(Math.max(cos, -1), 1)) * 180) / Math.PI), 1), 179)
    const side = Math.sign(t.x * v.y - t.y * v.x) || 1
    const a = Math.atan2(t.y, t.x) + side * ((angleDeg * Math.PI) / 180)
    dir = { x: Math.cos(a), y: Math.sin(a) }
  }
  return { zone, dir, angleDeg, hits: castRay(members, start.point, dir) }
}

/** The hit the shadow line ends on: the first one, unless the pointer is
 * already past it, then the next. */
export function pickHit(aim: Aim, start: PointMm, pointer: PointMm, toleranceMm: number): RayHit | null {
  if (aim.hits.length === 0) return null
  const along = (pointer.x - start.x) * aim.dir.x + (pointer.y - start.y) * aim.dir.y
  return aim.hits.find((h) => h.distance >= along - toleranceMm) ?? aim.hits[aim.hits.length - 1]
}

/** Appends a new straight divider from `start` to `hit`, splitting it at
 * every crossing (Q3) and re-sorting. */
export function drawDivider<T extends DividerLike>(geo: FrameGeometry, dividers: readonly T[], make: (from: DividerAnchor, to: DividerAnchor) => T, start: SnapHit, hit: RayHit): T[] {
  const members = allMembers(geo, resolveDividers(geo, dividers))
  const host = members.get(hit.memberId)
  if (!host) return [...dividers]
  const created = make(start.anchor, anchorOn(geo, host, hit.point))
  return splitAtCrossings(geo, [...dividers, created], created.id)
}

/** Problems a resolved set can have before any light is computed —
 * unresolvable ends and slants below the springing line (Q2). */
export function dividerProblems(geo: FrameGeometry, dividers: readonly DividerLike[]): { id: string; problem: 'unresolved' | 'notSquare' }[] {
  const resolved = resolveDividers(geo, dividers)
  const out: { id: string; problem: 'unresolved' | 'notSquare' }[] = []
  for (const d of dividers) {
    const r = resolved.get(d.id)
    if (!r) out.push({ id: d.id, problem: 'unresolved' })
    else if (zoneOf(geo, r) === 'rect' && r.axis === null) out.push({ id: d.id, problem: 'notSquare' })
  }
  return out
}
