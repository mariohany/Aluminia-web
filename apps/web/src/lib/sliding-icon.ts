import { movesLeft, movesRight, type SlidingLayoutInput } from '@repo/types/sliding'

/**
 * The sliding opening-type icon as a framework-free shape list —
 * docs/sliding_windows_planing.md §6. Transcribed from the prototype
 * Mario handed over (~/Downloads/sliding-window-icons/src/slidingGeometry.ts,
 * `buildSlidingIcon`): same viewBox, same constants, same shapes, so the
 * 28 preset tiles look exactly like its `preview.html`. The only input
 * change is that it reads this codebase's stored layout (one entry per
 * sash) instead of the prototype's `tracks[]`/`movement[]` pair — and
 * the frame PROFILE's rail count (`opts.rails`, planing §11) drives the
 * plan strip, so an empty rail shows as an empty line rather than
 * vanishing; a sash beyond it still widens the strip so it can be seen.
 *
 * Always the INTERIOR view (Mario, 2026-09-19: "icons always interior
 * view"): the highest rail is the front, drawn over the rest, and the
 * ▲ under the plan strip marks the inside. The elevation itself follows
 * the face toggle (window-shapes.tsx's sliding helpers); this icon is a
 * layout vocabulary, not a picture of the current face.
 *
 * Front/back is shown three ways, all monochrome:
 *  1. Elevation: a front sash is drawn over its back neighbour, and the
 *     back sash's hidden edge is drawn dashed (technical-drawing
 *     convention).
 *  2. Line weight: front-rail sashes get a heavier outline.
 *  3. Plan strip under the frame: one line per rail (back at the top,
 *     front at the bottom), each sash a solid bar on its rail.
 *
 * Fills are symbolic (`frame`/`sash`/`ink`/`none`) rather than colours
 * so the React component maps them onto theme tokens and a future PDF
 * renderer onto black and white — same posture as
 * `components/icons/opening-type-icon.tsx`'s hinged transcription.
 */

export type IconFill = 'frame' | 'sash' | 'ink' | 'none'

export type IconShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; stroke: number; fill: IconFill; dash?: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: number; dash?: string }
  | { kind: 'path'; d: string; stroke: number; fill: IconFill }

export interface SlidingIconModel {
  viewBox: { w: number; h: number }
  shapes: IconShape[]
}

const VB_W = 120
const FRAME = { x: 4, y: 4, w: 112, h: 80, wall: 4 }
/** Interlock overlap between sashes on different rails. */
const OVERLAP = 3
/** Sash profile width (glass inset); > OVERLAP so a hidden edge sits in the stile. */
const STILE = 4.5
const PLAN = { y: 90, h: 26 }

const round = (v: number) => Math.round(v * 100) / 100

export function buildSlidingIcon(
  layout: SlidingLayoutInput,
  opts: { showPlan?: boolean; rails?: number | null } = {},
): SlidingIconModel {
  const showPlan = opts.showPlan ?? true
  const rails = layout.sashes.map((sash) => sash.rail)
  const n = rails.length
  const railCount = Math.max(opts.rails ?? 0, ...rails.map((r) => r + 1), 1)
  const shapes: IconShape[] = []

  // --- Frame (outer + inner outline) ---
  const ix = FRAME.x + FRAME.wall
  const iy = FRAME.y + FRAME.wall
  const iw = FRAME.w - 2 * FRAME.wall
  const ih = FRAME.h - 2 * FRAME.wall
  shapes.push({ kind: 'rect', x: FRAME.x, y: FRAME.y, w: FRAME.w, h: FRAME.h, stroke: 2, fill: 'frame' })
  shapes.push({ kind: 'rect', x: ix, y: iy, w: iw, h: ih, stroke: 1, fill: 'none' })

  if (n === 0) return { viewBox: { w: VB_W, h: round(FRAME.y + FRAME.h + 4) }, shapes }

  // --- Sash x-positions: overlap only between different-rail neighbours ---
  const overlaps: number[] = rails.slice(1).map((rail, i) => (rail !== rails[i] ? OVERLAP : 0))
  const totalOverlap = overlaps.reduce((a, b) => a + b, 0)
  const sw = (iw + totalOverlap) / n
  const xs: number[] = []
  let cursor = ix
  for (let i = 0; i < n; i++) {
    if (i > 0) cursor -= overlaps[i - 1] ?? 0
    xs.push(cursor)
    cursor += sw
  }

  const strokeFor = (rail: number) => (railCount === 1 ? 1.6 : 1 + (rail / (railCount - 1)) * 1.1)
  const sy = iy + 0.75
  const sh = ih - 1.5

  // Draw back rails first so front sashes occlude them.
  const order = rails.map((rail, i) => ({ rail, i })).sort((a, b) => a.rail - b.rail || a.i - b.i)
  for (const { rail, i } of order) {
    const x = xs[i] ?? ix
    shapes.push({ kind: 'rect', x, y: sy, w: sw, h: sh, stroke: strokeFor(rail), fill: 'sash' })
    shapes.push({ kind: 'rect', x: x + STILE, y: sy + STILE, w: sw - 2 * STILE, h: sh - 2 * STILE, stroke: 0.7, fill: 'none' })
  }

  // Hidden edges of back sashes, dashed, on top of the front sash stile.
  for (let i = 0; i < n - 1; i++) {
    if (rails[i] === rails[i + 1]) continue
    const backIsLeft = (rails[i] ?? 0) < (rails[i + 1] ?? 0)
    const hx = backIsLeft ? (xs[i] ?? ix) + sw : (xs[i + 1] ?? ix)
    shapes.push({ kind: 'line', x1: hx, y1: sy + 1.5, x2: hx, y2: sy + sh - 1.5, stroke: 0.7, dash: '2 1.6' })
  }

  // Movement arrows in the glass, from each sash's stored opening type.
  const ay = iy + ih / 2
  layout.sashes.forEach((sash, i) => {
    const glassW = sw - 2 * STILE
    const len = Math.min(glassW * 0.7, 16)
    const cx = (xs[i] ?? ix) + sw / 2
    const x1 = cx - len / 2
    const x2 = cx + len / 2
    const head = Math.min(3, len * 0.35)
    shapes.push({ kind: 'line', x1, y1: ay, x2, y2: ay, stroke: 1 })
    if (movesLeft(sash.openingType)) {
      shapes.push({ kind: 'path', d: `M${x1 + head} ${ay - head} L${x1} ${ay} L${x1 + head} ${ay + head}`, stroke: 1, fill: 'none' })
    }
    if (movesRight(sash.openingType)) {
      shapes.push({ kind: 'path', d: `M${x2 - head} ${ay - head} L${x2} ${ay} L${x2 - head} ${ay + head}`, stroke: 1, fill: 'none' })
    }
  })

  let vbH = FRAME.y + FRAME.h + 4

  // --- Plan strip: back rail at top, front rail at bottom (inside) ---
  if (showPlan) {
    shapes.push({ kind: 'rect', x: FRAME.x, y: PLAN.y, w: FRAME.w, h: PLAN.h, stroke: 1.2, fill: 'frame' })
    const pad = 5
    const gap = railCount === 1 ? 0 : (PLAN.h - 2 * pad) / (railCount - 1)
    const railY = (rail: number) => (railCount === 1 ? PLAN.y + PLAN.h / 2 : PLAN.y + pad + rail * gap)
    for (let rail = 0; rail < railCount; rail++) {
      const y = railY(rail)
      shapes.push({ kind: 'line', x1: ix, y1: y, x2: ix + iw, y2: y, stroke: 0.5, dash: '1 1.5' })
    }
    const barH = Math.min(3.2, gap > 0 ? gap * 0.6 : 3.2)
    for (let i = 0; i < n; i++) {
      const y = railY(rails[i] ?? 0)
      shapes.push({ kind: 'rect', x: (xs[i] ?? ix) + 0.9, y: y - barH / 2, w: sw - 1.8, h: barH, stroke: 0, fill: 'ink' })
    }
    // Viewer-side marker: a small solid triangle under the front rail — the inside.
    const mx = FRAME.x + FRAME.w / 2
    const my = PLAN.y + PLAN.h + 1.5
    shapes.push({ kind: 'path', d: `M${mx - 2.5} ${my + 2.5} L${mx} ${my} L${mx + 2.5} ${my + 2.5} Z`, stroke: 0, fill: 'ink' })
    vbH = my + 4
  }

  return { viewBox: { w: VB_W, h: round(vbH) }, shapes }
}
