import { dist, pathPointAt, pathProject } from '@/lib/curves'
import type { PointMm } from '@/lib/arch-geometry'
import {
  aimFrom,
  allMembers,
  drawDivider,
  dividerProblems,
  pickHit,
  resolveDividers,
  snapStart,
  type DividerAnchor,
  type DividerLike,
  type FrameGeometry,
  type RayHit,
  type SnapHit,
} from '@/lib/dividers'

// The Divider tool's maths (docs/free_dividers_planing.md §6), pure so
// the drawing layer only turns pointer pixels into panel mm and paints.

/** What the pointer is over before the first click: the member, and the
 * readout value — mm along a straight member (x from the left, up from
 * the bottom on a jamb), % along the head or a slanted/curved divider. */
export interface HoverReadout {
  snap: SnapHit
  value: number
  unit: 'mm' | '%'
}

export function hoverReadout(geo: FrameGeometry, dividers: readonly DividerLike[], p: PointMm, toleranceMm: number, springOffsetMm: number): HoverReadout | null {
  const resolved = resolveDividers(geo, dividers)
  const snap = snapStart(geo, resolved, p, toleranceMm, springOffsetMm)
  if (!snap) return null
  const member = allMembers(geo, resolved).get(snap.anchor.on)
  const straight = member?.axis === 'h' || member?.axis === 'v'
  return straight ? { snap, value: Math.round(snap.anchor.at), unit: 'mm' } : { snap, value: Math.round(snap.anchor.at * 100), unit: '%' }
}

/** Why a shadow line can't be committed. `notSquare` gets the red
 * "Square only below the springing line" (§6.3); the rest just don't
 * commit. */
export type DrawRefusal = 'noHit' | 'notSquare' | 'overlap'

export interface DrawPreview<T extends DividerLike> {
  start: SnapHit
  zone: 'rect' | 'arch'
  angleDeg: number
  hit: RayHit | null
  lengthMm: number
  refusal: DrawRefusal | null
  /** The panel's dividers with the new one added, split at its
   * crossings (Q3) and sorted — `null` when refused. */
  dividers: T[] | null
  /** The new divider's ids (more than one when it was split). */
  added: string[]
}

/**
 * The shadow line from `start` toward `pointer` and what committing it
 * would give. Below the springing line it is square to the start member;
 * above, its angle snaps to whole degrees (`aimFrom`). Refused when it
 * meets nothing, when it would slant below the springing line (Q2), or
 * when it would lie on an existing member.
 */
export function previewDraw<T extends DividerLike>(
  geo: FrameGeometry,
  dividers: readonly T[],
  make: (from: DividerAnchor, to: DividerAnchor) => T,
  start: SnapHit,
  pointer: PointMm,
  toleranceMm: number,
  springOffsetMm: number,
): DrawPreview<T> | null {
  const resolved = resolveDividers(geo, dividers)
  const aim = aimFrom(geo, resolved, start, pointer, springOffsetMm)
  if (!aim) return null
  const base = { start, zone: aim.zone, angleDeg: aim.angleDeg }
  const hit = pickHit(aim, start.point, pointer, toleranceMm)
  if (!hit) return { ...base, hit: null, lengthMm: 0, refusal: 'noHit', dividers: null, added: [] }
  const lengthMm = dist(start.point, hit.point)
  const refused = (refusal: DrawRefusal): DrawPreview<T> => ({ ...base, hit, lengthMm, refusal, dividers: null, added: [] })

  const next = drawDivider(geo, dividers, make, start, hit)
  const before = new Set(dividers.map((d) => d.id))
  const added = next.filter((d) => !before.has(d.id)).map((d) => d.id)
  if (added.length === 0) return refused('noHit')
  if (dividerProblems(geo, next).some((p) => added.includes(p.id))) return refused('notSquare')

  // A piece whose middle sits on an existing member would double it up
  // (drawing up along a mullion from its own foot).
  const members = allMembers(geo, resolved)
  const nextResolved = resolveDividers(geo, next)
  for (const id of added) {
    const piece = nextResolved.get(id)
    if (!piece) return refused('noHit')
    const mid = pathPointAt(piece.path, 0.5)
    for (const m of members.values()) {
      if (pathProject(m.path, mid).dist < 1) return refused('overlap')
    }
  }
  return { ...base, hit, lengthMm, refusal: null, dividers: next, added }
}

// ---- Radius ⇄ bow (§6.5) -------------------------------------------------

/** The radius of a bow `sagMm` over `chordMm`; `null` when straight. */
export function radiusFromSag(chordMm: number, sagMm: number): number | null {
  const s = Math.abs(sagMm)
  if (s < 0.5 || chordMm <= 0) return null
  return (chordMm * chordMm) / (8 * s) + s / 2
}

/** The bow that gives `radiusMm` over `chordMm` — the shallow arc, never
 * more than a half circle (a radius under half the chord is raised to
 * it). `sign` picks the side, `chordSagSeg`'s convention. */
export function sagFromRadius(chordMm: number, radiusMm: number, sign: number): number {
  const half = chordMm / 2
  const r = Math.max(radiusMm, half)
  return (sign < 0 ? -1 : 1) * (r - Math.sqrt(Math.max(r * r - half * half, 0)))
}

/** Which side a fresh bow goes: up, toward the head (`chordSagSeg`'s
 * positive side is `(-dir.y, dir.x)`, which points down for a
 * left → right chord). */
export function defaultBowSign(from: PointMm, to: PointMm): number {
  const dx = to.x - from.x
  return dx > 0 ? -1 : 1
}
