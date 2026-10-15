import { SystemType } from '@repo/types/lookups'
import { HeadShape, SectionKind, type WindowPanelInput } from '@repo/types/windows'
import { headCircles, headLengthMm, type HeadOutline } from './arch-geometry.ts'
import { segLength } from './curves.ts'
import { resolvePanelLayout, type PanelFrameFacts } from './panel-geometry.ts'
import { buildAssemblyLayout, dividerNames, type WindowPart } from './window-geometry.ts'

// Every aluminium piece a window is cut into, for the bar optimiser
// (docs/reports_planing.md §3). Pure: it reads the same built geometry
// the editor draws, so a report can't disagree with the drawing. Lengths
// come from the stand-in profile widths until profiles carry real ones
// (decision D1): frame lengths are exact, the rest approximate.
//
// Joints (WINDOW_GEOMETRY_SPEC.md "Cut angles per member"): frame and
// sash are 45° mitres, so every piece is the outer size; glazing beads
// are 90° butt cuts, top and bottom full width, the sides between them.
// A curved member (arched head, curved bead or divider) is one piece of
// its arc length, optimised as a straight bar (D6). Sash bars of the
// fixed-mullion opening types are left out entirely for now (Mario,
// 2026-10-15: that opening type isn't built out yet).

export type CutMember = 'frame' | 'sash' | 'divider' | 'bead'

/** Where on its part a piece sits — the label's second half (D17). An
 * arched head is `head` (two pieces on a gothic arch, `positionIndex`
 * 0/1); a shaped light's bead is one `edge` per side of its outline. */
export type PiecePosition = 'top' | 'bottom' | 'left' | 'right' | 'head' | 'edge' | 'bar'

export interface PieceAt {
  panelIndex: number
  /** The light the piece belongs to; `null` for frame and dividers. */
  sectionIndex: number | null
  /** Which sash in its section (0-based); `null` off a sash. */
  sashIndex: number | null
  position: PiecePosition
  positionIndex?: number
  /** A divider's display name, numbered the way the drawing reads. */
  divider?: { kind: 'mullion' | 'transom'; number: number }
}

export interface CutPiece {
  member: CutMember
  /** The scoped profile ref (`platform:<id>` / `company:<id>`). */
  profile: string
  /** Whole millimetres. */
  lengthMm: number
  curved: boolean
  /** How many identical pieces: the window's quantity. */
  count: number
  at: PieceAt
}

/** A part that has no profile to cut it from (D16) — listed, not cut. */
export interface SkippedPart {
  member: CutMember
  at: PieceAt
  reason: 'noProfile'
}

export interface CutList {
  pieces: CutPiece[]
  skipped: SkippedPart[]
}

export interface CutListInput {
  panels: WindowPanelInput[]
  /** One per panel, same order: the frame's catalogue facts. */
  facts: PanelFrameFacts[]
  quantity: number
}

export function buildCutList(input: CutListInput): CutList {
  const resolved = input.panels.map((given, i) => resolvePanelLayout(given, input.facts[i] ?? { systemType: null, flyScreenAllowed: false }))
  const { parts } = buildAssemblyLayout(resolved.map((r) => r.input))
  const out: CutList = { pieces: [], skipped: [] }

  resolved.forEach(({ panel, input: layoutInput }, panelIndex) => {
    const own = parts.filter((p) => p.panelIndex === panelIndex)
    const emit = (member: CutMember, profile: string | null | undefined, at: PieceAt, pieces: { lengthMm: number; curved: boolean; position: PiecePosition; positionIndex?: number }[]) => {
      if (!profile) {
        out.skipped.push({ member, at, reason: 'noProfile' })
        return
      }
      for (const piece of pieces) {
        if (!(piece.lengthMm >= 1)) continue
        out.pieces.push({
          member,
          profile,
          lengthMm: Math.round(piece.lengthMm),
          curved: piece.curved,
          count: input.quantity,
          at: { ...at, position: piece.position, ...(piece.positionIndex !== undefined ? { positionIndex: piece.positionIndex } : {}) },
        })
      }
    }

    // Frame: a hinged door has no sill.
    const frame = own.find((p) => p.kind === 'frame')
    if (frame) {
      const doorSill = panel.isDoor && layoutInput.systemType === SystemType.HINGED
      emit('frame', panel.frameProfile, { panelIndex, sectionIndex: null, sashIndex: null, position: 'top' }, ringPieces(frame, { sill: !doorSill }))
    }

    // Dividers: the band's stored cut length; own profile, else the
    // panel's divider default.
    const names = dividerNames(own)
    for (const part of own.filter((p) => p.kind === 'divider')) {
      const divider = panel.dividers.find((d) => d.id === part.dividerId)
      const at: PieceAt = { panelIndex, sectionIndex: null, sashIndex: null, position: 'bar', divider: names.get(part.id) }
      emit('divider', divider?.profile ?? panel.dividerProfile, at, [{ lengthMm: part.cutLengthMm ?? 0, curved: (divider?.sagMm ?? 0) !== 0, position: 'bar' }])
    }

    // Sashes and sliding leaves: a full mitred ring each.
    for (const part of own.filter((p) => p.kind === 'sash')) {
      const section = part.sectionIndex !== null ? panel.sections[part.sectionIndex] : undefined
      emit('sash', section?.sashProfile, { panelIndex, sectionIndex: part.sectionIndex, sashIndex: part.index, position: 'top' }, ringPieces(part, { sill: true }))
    }

    // Glazing beads: wherever the section has a bead profile — fixed
    // lights today, sash glass once sash ↔ bead pairings exist
    // (docs/profile_beads_planing.md). No bead profile on an opening
    // section is normal, not a skipped part.
    for (const part of own.filter((p) => p.kind === 'glass')) {
      const section = part.sectionIndex !== null ? panel.sections[part.sectionIndex] : undefined
      if (!section) continue
      if (!section.beadProfile && section.kind !== SectionKind.FIXED) continue
      const sashIndex = section.kind === SectionKind.FIXED ? null : part.index
      const at: PieceAt = { panelIndex, sectionIndex: part.sectionIndex, sashIndex, position: 'top' }
      const pieces = part.beadOpening
        ? beadPieces(part.beadOpening, part.beadSill ?? true, layoutInput.metrics.beadFace)
        : part.clearOutline
          ? part.clearOutline.map((seg, i) => ({ lengthMm: segLength(seg), curved: seg.kind === 'arc', position: 'edge' as const, positionIndex: i }))
          : []
      emit('bead', section.beadProfile, at, pieces)
    }
  })

  return out
}

/** A mitred ring (frame or sash): outer size on every side; an arched
 * head is one curved piece per arc, the jambs straight up to the
 * springing line. */
function ringPieces(part: WindowPart, opts: { sill: boolean }): { lengthMm: number; curved: boolean; position: PiecePosition; positionIndex?: number }[] {
  const { width, height } = part.rectMm
  const pieces: { lengthMm: number; curved: boolean; position: PiecePosition; positionIndex?: number }[] = []
  if (part.head && part.head.shape !== HeadShape.FLAT && part.head.riseMm > 0) {
    const outline: HeadOutline = { rect: part.rectMm, shape: part.head.shape, riseMm: part.head.riseMm }
    pieces.push(...headPieces(outline))
    const jamb = height - part.head.riseMm
    pieces.push({ lengthMm: jamb, curved: false, position: 'left' }, { lengthMm: jamb, curved: false, position: 'right' })
  } else {
    pieces.push({ lengthMm: width, curved: false, position: 'top' })
    pieces.push({ lengthMm: height, curved: false, position: 'left' }, { lengthMm: height, curved: false, position: 'right' })
  }
  if (opts.sill) pieces.push({ lengthMm: width, curved: false, position: 'bottom' })
  return pieces
}

/** Beads lining an opening, 90° butt: top and bottom run the full width,
 * the sides sit between them. On an arch the curved bead(s) rest on the
 * sides at the springing line. */
function beadPieces(opening: HeadOutline, sill: boolean, beadFace: number): { lengthMm: number; curved: boolean; position: PiecePosition; positionIndex?: number }[] {
  const { width, height } = opening.rect
  const pieces: { lengthMm: number; curved: boolean; position: PiecePosition; positionIndex?: number }[] = []
  const below = sill ? beadFace : 0
  if (opening.shape !== HeadShape.FLAT && opening.riseMm > 0) {
    pieces.push(...headPieces(opening))
    const side = height - opening.riseMm - below
    pieces.push({ lengthMm: side, curved: false, position: 'left' }, { lengthMm: side, curved: false, position: 'right' })
  } else {
    pieces.push({ lengthMm: width, curved: false, position: 'top' })
    const side = height - beadFace - below
    pieces.push({ lengthMm: side, curved: false, position: 'left' }, { lengthMm: side, curved: false, position: 'right' })
  }
  if (sill) pieces.push({ lengthMm: width, curved: false, position: 'bottom' })
  return pieces
}

/** One curved piece per arc of the head: two on a gothic arch. */
function headPieces(outline: HeadOutline): { lengthMm: number; curved: boolean; position: PiecePosition; positionIndex?: number }[] {
  const arcs = Math.max(headCircles(outline).length, 1)
  const each = headLengthMm(outline) / arcs
  return Array.from({ length: arcs }, (_, i) => ({ lengthMm: each, curved: true, position: 'head' as const, ...(arcs > 1 ? { positionIndex: i } : {}) }))
}

