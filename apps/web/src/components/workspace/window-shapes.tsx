import { SystemType } from '@repo/types/lookups'
import { HingedOpeningType, HeadShape } from '@repo/types/windows'
import { DOUBLE_DOOR_OPENING_TYPES, type WindowPart } from '@/lib/window-geometry'
import { headPointAt, insetHeadOutline, type HeadOutline, type PointMm } from '@/lib/arch-geometry'
import { pointAlongBar, resolveBar } from '@/lib/arch-bars'
import type { ProfileMetrics } from '@/lib/profile-metrics'
import type { WindowBarInput } from '@repo/types/windows'
import { movesLeft, movesRight } from '@repo/types/sliding'

/**
 * The pure paint layer shared by the interactive elevation
 * (`window-drawing.tsx`) and the static one on a canvas card
 * (`window-thumbnail.tsx`).
 *
 * Only geometry-to-SVG here: path strings, bar grids, and the
 * hinge/pivot symbol tables. Nothing about selection, hover, issues or
 * dimension inputs — those belong to the interactive drawing alone,
 * which is precisely why the two components aren't one component with a
 * `readOnly` flag. They paint the same shapes and do genuinely
 * different things around them.
 */

// Base (no-colour) glass tint — opaque here, thinned separately by
// `GLASS_FILL_OPACITY` so a real colour can share the exact same
// translucency instead of needing its own baked-in alpha.
export const DEFAULT_GLASS_FILL = 'oklch(0.75 0.06 230)'
export const GLASS_FILL_OPACITY = 0.35
export const MESH_STROKE = 'var(--muted-foreground)'
/** The fly-screen mesh's own border, in mm — a drawing weight, not a
 * profile band, so it lives here rather than in `ProfileMetrics`. */
export const MESH_STROKE_WIDTH_MM = 15
/** White powder-coat is the real-world default finish, not a
 * placeholder — a panel with no colour picked should read as white, not
 * as a dark fallback. Literal, not a theme token: this is the
 * aluminium's own colour, independent of light/dark UI mode. */
export const DEFAULT_FRAME_FILL = '#FFFFFF'

/** Only hinged panels expose the door option, so a door's sill-less
 * frame is a hinged-only shape. */
export function isDoorHinged(isDoor: boolean, systemType: SystemType | null): boolean {
  return isDoor && systemType === SystemType.HINGED
}

/** Which axis a fixed-mullion opening type splits its one light on —
 * `null` for every other type, including double-door (that one gets two
 * real sashes from window-geometry.ts instead, no bar to draw). */
export function mullionGridFor(
  openingType: HingedOpeningType | null,
): { columns: number; rows: number } | null {
  if (openingType === HingedOpeningType.FIXED_VERTICAL_MULLION) return { columns: 2, rows: 1 }
  if (openingType === HingedOpeningType.FIXED_HORIZONTAL_MULLION) return { columns: 1, rows: 2 }
  return null
}

/** The smallest rect containing all of `rects` — used to find a sash's
 * own opening (its ring's inner hole) from however many glass panes
 * currently share its index, whether that's the usual one or the two a
 * fixed-mullion split produces. */
export function boundingRect(rects: WindowPart['rectMm'][]): WindowPart['rectMm'] {
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** The Georgian bar grid embedded in a glass pane's spacer gap —
 * `columns - 1` evenly-spaced vertical bars and `rows - 1` horizontal
 * ones, each a thin filled rect (not a hairline stroke) so it reads as
 * the same kind of material as the frame/sash rather than a drawing
 * annotation. */
export function georgianBars(
  rect: WindowPart['rectMm'],
  grid: { columns: number; rows: number },
  barWidth: number,
  fill: string,
): React.ReactNode[] {
  const bars: React.ReactNode[] = []
  for (let i = 1; i < grid.columns; i++) {
    const x = rect.x + (rect.width * i) / grid.columns - barWidth / 2
    bars.push(<rect key={`v${i}`} x={x} y={rect.y} width={barWidth} height={rect.height} fill={fill} />)
  }
  for (let i = 1; i < grid.rows; i++) {
    const y = rect.y + (rect.height * i) / grid.rows - barWidth / 2
    bars.push(<rect key={`h${i}`} x={rect.x} y={y} width={rect.width} height={barWidth} fill={fill} />)
  }
  return bars
}

/** An outer rect with a rectangular hole cut out of it (`fillRule="evenodd"`
 * on the caller's `<path>`) — draws as one filled ring whose stroke traces
 * both the outer and inner edges in a single pass. */
export function ringPath(outer: WindowPart['rectMm'], inner: WindowPart['rectMm']): string {
  const outerD = `M${outer.x} ${outer.y} H${outer.x + outer.width} V${outer.y + outer.height} H${outer.x} Z`
  const innerD = `M${inner.x} ${inner.y} H${inner.x + inner.width} V${inner.y + inner.height} H${inner.x} Z`
  return `${outerD} ${innerD}`
}

/** Same idea as `ringPath`, but for a hinged door's frame: the outer and
 * inner rects already share the same bottom edge (frameOpening drops its
 * bottom inset for this case), so tracing them as two independent closed
 * rects would still stroke a full-width line along that shared edge. This
 * instead walks the two boundaries as one open bracket/"C" shape — top bar
 * plus both posts, no sill — so the only bottom-facing strokes left are
 * the two short caps where each post's outer and inner edges meet. */
export function openBottomFramePath(outer: WindowPart['rectMm'], inner: WindowPart['rectMm']): string {
  const bottom = outer.y + outer.height
  return [
    `M${outer.x} ${bottom}`,
    `L${outer.x} ${outer.y}`,
    `L${outer.x + outer.width} ${outer.y}`,
    `L${outer.x + outer.width} ${bottom}`,
    `L${inner.x + inner.width} ${bottom}`,
    `L${inner.x + inner.width} ${inner.y}`,
    `L${inner.x} ${inner.y}`,
    `L${inner.x} ${bottom}`,
    'Z',
  ].join(' ')
}

// ---- Fabrication detail ----------------------------------------------
//
// The lines a real elevation carries beyond its bands: the 45° miters
// where frame and sash members meet, the face-step seams along the
// frame, the glazing bead as the four pieces it is actually cut into,
// and the gasket line where bead meets glass. All pure geometry in mm,
// returned as path data or rects for the detail renderers below to
// style (docs/elevation_detail_planing.md §3).

/** Where the frame's face steps — two seams this far in from the outer
 * edge, following the ring's own shape. Drawing offsets from `gen.py`,
 * not profile widths; a seam that would land past the frame face is
 * skipped rather than drawn on the sash. */
export const FRAME_SEAM_OFFSETS_MM = [14, 30]
/** The glazing gasket's own colour — rubber, so a fixed dark tone that
 * never takes the frame finish or the theme. */
export const GASKET_STROKE = '#3f4650'

/** Fallback outline when a fill isn't a parseable hex — the theme's own
 * border tone, as every outline used before seams took the finish into
 * account. */
export const FALLBACK_SEAM_STROKE = 'var(--border)'

const seamColorCache = new Map<string, string>()

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const digits = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number]
}

/**
 * The hairline colour for seams, miters, bead cuts and part outlines
 * on a frame painted `frameHex` — spec §9's luminance flip. With flat
 * fills a joint line only reads if it contrasts, so a light finish
 * gets a darker seam and a dark one (anodised, RAL 9005) a lighter
 * seam; a fixed "darken by 20%" vanishes on the dark half of the
 * palette. Shift is per RGB channel, clamped. Memoised per hex —
 * every part in a panel asks for the same answer.
 */
export function seamColorFor(frameHex: string): string {
  const cached = seamColorCache.get(frameHex)
  if (cached) return cached
  const rgb = parseHex(frameHex)
  if (!rgb) return FALLBACK_SEAM_STROKE
  const [r, g, b] = rgb
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const shift = lum > 0.42 ? -78 : 58
  const channel = (v: number) => Math.min(255, Math.max(0, v + shift)).toString(16).padStart(2, '0')
  const seam = `#${channel(r)}${channel(g)}${channel(b)}`
  seamColorCache.set(frameHex, seam)
  return seam
}

export function expandRect(rect: WindowPart['rectMm'], by: number): WindowPart['rectMm'] {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + 2 * by, height: rect.height + 2 * by }
}

/**
 * The 45° miter diagonals of a rectangular ring: one line per corner
 * from the outer corner to the matching inner one. `'top'` draws only
 * the two head corners — a hinged door's frame has no sill, so its
 * posts run straight out of the bottom with nothing to miter into.
 * `'bottom'` draws only the two sill corners — an arched member is
 * bent round its head, not mitered, so only its feet are cut.
 */
export function miterLinesPath(
  outer: WindowPart['rectMm'],
  inner: WindowPart['rectMm'],
  corners: 'all' | 'top' | 'bottom' = 'all',
): string {
  const right = outer.x + outer.width
  const bottom = outer.y + outer.height
  const innerRight = inner.x + inner.width
  const innerBottom = inner.y + inner.height
  const lines: string[] = []
  if (corners !== 'bottom') {
    lines.push(`M${outer.x} ${outer.y} L${inner.x} ${inner.y}`, `M${right} ${outer.y} L${innerRight} ${inner.y}`)
  }
  if (corners !== 'top') {
    lines.push(`M${outer.x} ${bottom} L${inner.x} ${innerBottom}`, `M${right} ${bottom} L${innerRight} ${innerBottom}`)
  }
  return lines.join(' ')
}

/**
 * The frame's face-step seams: one closed outline per offset, inset
 * that far inside `outer`. `openBottom` (a hinged door) walks each as
 * an open bracket instead — the seam runs down both posts and stops at
 * the bottom edge, the same way `openBottomFramePath` treats the ring.
 * Offsets at or past `maxInset` (the ring's own face) are dropped.
 */
export function faceSeamPaths(
  outer: WindowPart['rectMm'],
  offsetsMm: number[],
  maxInset: number,
  openBottom = false,
): string[] {
  const bottom = outer.y + outer.height
  return offsetsMm
    .filter((offset) => offset < maxInset)
    .map((offset) => {
      const x0 = outer.x + offset
      const x1 = outer.x + outer.width - offset
      const y0 = outer.y + offset
      if (openBottom) return `M${x0} ${bottom} L${x0} ${y0} L${x1} ${y0} L${x1} ${bottom}`
      const y1 = bottom - offset
      return `M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z`
    })
}

/** The arched sibling of `faceSeamPaths`: each seam is the frame's own
 * outline inset by its offset, so it follows the curve round the head.
 * No open-bottom variant — an arched panel is never a door. */
export function archFaceSeamPaths(outer: HeadOutline, offsetsMm: number[], maxInset: number): string[] {
  return offsetsMm.filter((offset) => offset < maxInset).map((offset) => archOutlinePath(insetHeadOutline(outer, offset)))
}

/**
 * The glazing bead of an arched sash as the two pieces it is cut into
 * (spec §5, decision 3): a curved band bent round the head and down
 * both jambs, resting on a straight bottom piece that runs the full
 * rebate width. The band is the bead-wide strip just outside the glass,
 * cut off level with the glass's bottom edge so its two feet stop where
 * the bottom piece begins; drawn first, so the bottom piece's top edge
 * is the visible cut line. The holder is the sash (`sashFace`) or, on a
 * fixed light, the frame (`frameFace + beadFace`); `holderOutline` and
 * `holderFace` locate the band's outer edge the same way
 * `buildWindowLayout` located the glass — `insetHeadOutline` from the
 * holder — so the two can't drift apart.
 */
export function archBeadPieces(
  holderOutline: HeadOutline,
  glassOutline: HeadOutline,
  holderFace: number,
  bead: number,
): { bandPathD: string; bottom: WindowPart['rectMm'] } {
  const outer = insetHeadOutline(holderOutline, holderFace - bead)
  const glassBottom = glassOutline.rect.y + glassOutline.rect.height
  const cutOuter: HeadOutline = { ...outer, rect: { ...outer.rect, height: Math.max(glassBottom - outer.rect.y, 1) } }
  return {
    bandPathD: `${archOutlinePath(cutOuter)} ${archOutlinePath(glassOutline)}`,
    bottom: { x: outer.rect.x, y: glassBottom, width: outer.rect.width, height: bead },
  }
}

/**
 * The glazing bead around one glass pane as the four pieces it is cut
 * into — 90° butt joints, so the top and bottom pieces run the full
 * rebate width and the left and right ones sit between them (decision
 * 3). Each piece is its own rect so each gets its own outline and the
 * cuts show at the corners as short horizontal lines, not diagonals.
 * The band occupies the `bead`-wide strip just outside `glass`.
 */
export function beadPieces(glass: WindowPart['rectMm'], bead: number): { key: string; rect: WindowPart['rectMm'] }[] {
  const outer = expandRect(glass, bead)
  return [
    { key: 'top', rect: { x: outer.x, y: outer.y, width: outer.width, height: bead } },
    { key: 'bottom', rect: { x: outer.x, y: glass.y + glass.height, width: outer.width, height: bead } },
    { key: 'left', rect: { x: outer.x, y: glass.y, width: bead, height: glass.height } },
    { key: 'right', rect: { x: glass.x + glass.width, y: glass.y, width: bead, height: glass.height } },
  ]
}

// ---- Detail layers ------------------------------------------------------
//
// The fabrication detail as drawn — one implementation for the
// interactive elevation AND the canvas-card thumbnail (the user asked
// for the full detail on cards too, 2026-09-12, reversing planing
// decision 7). The interactive drawing nests these inside each part's
// InteractivePart so they scroll/hit-test with the part; the thumbnail
// drops them straight into its `<g>`. Every layer is `pointer-events:
// none` — the part's own shape stays the click target.

/** What every detail layer in a panel shares: the finish, the hairline
 * colour derived from it, and the drawing's hairline weight. */
export interface DetailStyle {
  frameFill: string
  seamStroke: string
  strokeWeight: number
}

function beadRects(glass: WindowPart, bead: number, style: DetailStyle): React.ReactNode[] {
  return beadPieces(glass.rectMm, bead).map((piece) => (
    <rect
      key={`${glass.id}-bead-${piece.key}`}
      x={piece.rect.x}
      y={piece.rect.y}
      width={piece.rect.width}
      height={piece.rect.height}
      fill={style.frameFill}
      stroke={style.seamStroke}
      strokeWidth={style.strokeWeight * 0.8}
    />
  ))
}

/**
 * The frame's detail. Flat: two face-step seams along the ring, then
 * the 45° miters at each corner — from the outer corner to where the
 * frame face ends: the sash's outer corner, or on a fixed unit (no
 * sash) the bead's outer corner. A fixed unit also gets its bead here,
 * since the bead belongs to the part holding the glass (decision 4)
 * and here that's the frame. Arched: the frame is bent round its head,
 * not cut — seams follow the curve and the only miters are at its two
 * feet, where the jambs meet the sill.
 */
export function renderFrameDetail({
  frame,
  frameOpening,
  frameOutline,
  innerOutline,
  hasSashes,
  fixedGlasses,
  doorHinged,
  metrics,
  style,
}: {
  frame: WindowPart
  frameOpening: WindowPart['rectMm'] | null
  frameOutline: HeadOutline | null
  /** The arched hole in the frame ring: the single sash's outline, or
   * on a fixed light (no sash) the single glass's — always section 0's,
   * the only section an arch ever touches. */
  innerOutline: HeadOutline | null
  /** Flat branch: does ANY section in this panel have a sash — decides
   * how far the frame's own corner miter reaches (docs/
   * sections_planing.md §4: "frame miters are unchanged" — kept as one
   * panel-wide flag rather than made a per-edge-segment rule). Arch
   * branch: does the archable section (0) specifically have a sash —
   * the caller passes the value that matches whichever branch actually
   * runs, since only one of the two ever does per call. */
  hasSashes: boolean
  /** Glasses whose OWN section has no sash — i.e. actually fixed
   * sections, pre-filtered by the caller (a glass belonging to a
   * fixed-mullion split of an OPENING section still has a sash and is
   * excluded). Each gets its own frame-mounted bead here; a sash-mounted
   * glass gets its bead from `renderSashDetail` instead. */
  fixedGlasses: WindowPart[]
  doorHinged: boolean
  metrics: ProfileMetrics
  style: DetailStyle
}): React.ReactNode {
  const { frameFill, seamStroke, strokeWeight } = style
  if (frameOutline) {
    if (!innerOutline) return null
    // A fixed light's bead is bent round the frame's own head, the
    // same curved band + bottom piece a sash gets — with the frame as
    // the holder (`frameFace + beadFace` in to the glass).
    const fixedBead = hasSashes
      ? null
      : archBeadPieces(frameOutline, innerOutline, metrics.frameFace + metrics.beadFace, metrics.beadFace)
    return (
      <g pointerEvents="none">
        {archFaceSeamPaths(frameOutline, FRAME_SEAM_OFFSETS_MM, metrics.frameFace).map((d, i) => (
          <path key={i} d={d} fill="none" stroke={seamStroke} strokeWidth={strokeWeight * 0.8} opacity={0.7} />
        ))}
        <path
          d={miterLinesPath(frame.rectMm, fixedBead ? fixedBead.bottom : innerOutline.rect, 'bottom')}
          fill="none"
          stroke={seamStroke}
          strokeWidth={strokeWeight}
        />
        {fixedBead && (
          <>
            <path
              d={fixedBead.bandPathD}
              fillRule="evenodd"
              fill={frameFill}
              stroke={seamStroke}
              strokeWidth={strokeWeight * 0.8}
            />
            <rect
              x={fixedBead.bottom.x}
              y={fixedBead.bottom.y}
              width={fixedBead.bottom.width}
              height={fixedBead.bottom.height}
              fill={frameFill}
              stroke={seamStroke}
              strokeWidth={strokeWeight * 0.8}
            />
          </>
        )}
      </g>
    )
  }
  if (!frameOpening) return null
  return (
    <g pointerEvents="none">
      {faceSeamPaths(frame.rectMm, FRAME_SEAM_OFFSETS_MM, metrics.frameFace, doorHinged).map((d, i) => (
        <path key={i} d={d} fill="none" stroke={seamStroke} strokeWidth={strokeWeight * 0.8} opacity={0.7} />
      ))}
      <path
        d={miterLinesPath(
          frame.rectMm,
          hasSashes ? frameOpening : expandRect(frameOpening, metrics.beadFace),
          doorHinged ? 'top' : 'all',
        )}
        fill="none"
        stroke={seamStroke}
        strokeWidth={strokeWeight}
      />
      {fixedGlasses.flatMap((glass) => beadRects(glass, metrics.beadFace, style))}
    </g>
  )
}

/**
 * A sash's detail. Flat: miters from its outer corners to the bead's
 * outer corners — the sash member is the ring minus the bead strip —
 * and the bead as its four pieces around EACH pane (a fixed-mullion
 * sash has two, each beaded on its own), same fill as the sash, own
 * hairline, so the butt joints read as cuts. Arched: miters at the two
 * feet only, and the bead as a curved band resting on a straight
 * full-width bottom piece (spec §5), bottom piece drawn last so its
 * top edge is the cut line the band's feet stop at.
 */
export function renderSashDetail({
  sash,
  opening,
  sashOutline,
  glassOutline,
  glassesForSash,
  metrics,
  style,
}: {
  sash: WindowPart
  opening: WindowPart['rectMm']
  sashOutline: HeadOutline | null
  glassOutline: HeadOutline | null
  glassesForSash: WindowPart[]
  metrics: ProfileMetrics
  style: DetailStyle
}): React.ReactNode {
  const { frameFill, seamStroke, strokeWeight } = style
  const bead = metrics.beadFace
  if (sashOutline) {
    if (!glassOutline) return null
    const pieces = archBeadPieces(sashOutline, glassOutline, metrics.sashFace, bead)
    return (
      <g pointerEvents="none">
        {/* The bottom piece's own bottom corners ARE the bead's outer
            corners — where the sash member's foot miters end. */}
        <path d={miterLinesPath(sash.rectMm, pieces.bottom, 'bottom')} fill="none" stroke={seamStroke} strokeWidth={strokeWeight} />
        <path d={pieces.bandPathD} fillRule="evenodd" fill={frameFill} stroke={seamStroke} strokeWidth={strokeWeight * 0.8} />
        <rect
          x={pieces.bottom.x}
          y={pieces.bottom.y}
          width={pieces.bottom.width}
          height={pieces.bottom.height}
          fill={frameFill}
          stroke={seamStroke}
          strokeWidth={strokeWeight * 0.8}
        />
      </g>
    )
  }
  return (
    <g pointerEvents="none">
      <path d={miterLinesPath(sash.rectMm, expandRect(opening, bead))} fill="none" stroke={seamStroke} strokeWidth={strokeWeight} />
      {glassesForSash.flatMap((glass) => beadRects(glass, bead, style))}
    </g>
  )
}

/**
 * A divider's own paint: one filled rect in the frame's finish with a
 * hairline outline — no seams, miters or end marks (docs/
 * sections_planing.md decision 10: unlike a frame/sash ring, a divider
 * isn't built from separate mitered members, so it has none of their
 * joinery to draw). `stroke` is the caller's call — `seamStroke` for the
 * resting state, `partStroke(...)` once selection/issues are in play —
 * same posture as every ring path above, which is why this takes the
 * colour rather than a `DetailStyle`.
 */
export function renderDivider(divider: WindowPart, fill: string, stroke: string, strokeWidth: number): React.ReactNode {
  return (
    <rect
      x={divider.rectMm.x}
      y={divider.rectMm.y}
      width={divider.rectMm.width}
      height={divider.rectMm.height}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  )
}

/** The gasket: the rubber line where bead meets glass, traced on the
 * pane's own edge (curved or not) in a fixed dark tone — above the
 * glass fill and bead, below the bars, so it reads as the seal it is. */
export function renderGasket(glass: WindowPart, glassOutline: HeadOutline | null, strokeWeight: number): React.ReactNode {
  return (
    <path
      d={archOutlinePath(glassOutline ?? { rect: glass.rectMm, shape: HeadShape.FLAT, riseMm: 0 })}
      fill="none"
      stroke={GASKET_STROKE}
      strokeWidth={strokeWeight * 1.6}
      pointerEvents="none"
    />
  )
}

// ---- Arched outlines -----------------------------------------------
//
// The arched siblings of ringPath/openBottomFramePath above, for a part
// carrying a `head` (see window-geometry.ts's WindowPart). Sampled from
// `headPointAt` rather than hand-derived as an SVG arc command — that
// function is already numerically verified (arch-geometry.ts), so
// reusing it here means the drawn curve and the bar-anchor system can
// never quietly disagree with each other; deriving fresh SVG arc-flag
// maths would be a second, independent place for the same class of
// sign/direction bug arch-geometry.ts's own gothic derivation already
// caught once. 24 segments is smooth at any on-screen size a window
// elevation is actually drawn at.

const ARCH_PATH_SEGMENTS = 24

/** One closed outline: sill → left jamb → the head curve → right jamb
 * → back to the sill. Degenerates to a plain rect path for a flat
 * head, so a caller never needs to branch on shape. */
export function archOutlinePath(o: HeadOutline, segments = ARCH_PATH_SEGMENTS): string {
  const bottom = o.rect.y + o.rect.height
  const right = o.rect.x + o.rect.width
  if (o.shape === HeadShape.FLAT) {
    return `M${o.rect.x} ${bottom} L${o.rect.x} ${o.rect.y} L${right} ${o.rect.y} L${right} ${bottom} Z`
  }
  const pts: string[] = []
  for (let i = 0; i <= segments; i++) {
    const p = headPointAt(o, i / segments)
    pts.push(`${p.x} ${p.y}`)
  }
  return `M${o.rect.x} ${bottom} L${pts.join(' L')} L${right} ${bottom} Z`
}

/** The arched sibling of `ringPath` — an outer and an inner arched
 * outline traced as one path, `fillRule="evenodd"` on the caller's
 * `<path>` cuts the inner one out as a hole, same contract as
 * `ringPath`. */
export function archRingPath(outer: HeadOutline, inner: HeadOutline): string {
  return `${archOutlinePath(outer)} ${archOutlinePath(inner)}`
}

/** A `WindowPart`'s own outline, iff it's arched — `null` for a flat
 * part (or one with no `head` at all), so `const o = outlineOf(part)`
 * followed by `if (o)` is the one check both drawing components need
 * before reaching for `archOutlinePath`/`archRingPath` instead of the
 * plain-rect functions above. */
export function outlineOf(part: WindowPart): HeadOutline | null {
  return part.head ? { rect: part.rectMm, shape: part.head.shape, riseMm: part.head.riseMm } : null
}

// ---- Glazing bars -----------------------------------------------------

/** SVG path data for one bar between two already-resolved points
 * (`resolveBar` in arch-bars.ts). A straight line for `sagMm === 0`;
 * otherwise sampled from the same `pointAlongBar` the anchor system
 * itself uses, for the same reason `archOutlinePath` samples
 * `headPointAt` rather than deriving its own arc command. */
export function barPath(from: PointMm, to: PointMm, sagMm: number, segments = 16): string {
  if (sagMm === 0) return `M${from.x} ${from.y} L${to.x} ${to.y}`
  const pts: string[] = []
  for (let i = 0; i <= segments; i++) {
    const p = pointAlongBar(from, to, sagMm, i / segments)
    pts.push(`${p.x} ${p.y}`)
  }
  return `M${pts.join(' L')}`
}

/** Every bar in a panel, resolved against its glass outline and turned
 * into path data — the one call both drawing components make to get
 * everything they need to render the bar layer. A bar whose anchor
 * chain is broken (a dangling reference mid-edit) is silently dropped
 * rather than drawn wrong; `resolveBar` already returns `null` for
 * exactly that rather than throwing. */
export function barPathsFor(bars: WindowBarInput[], glassOutline: HeadOutline): { id: string; d: string }[] {
  const paths: { id: string; d: string }[] = []
  for (const bar of bars) {
    const resolved = resolveBar(bar, bars, glassOutline)
    if (!resolved) continue
    paths.push({ id: bar.id, d: barPath(resolved.from, resolved.to, bar.sagMm) })
  }
  return paths
}
// ---- Opening-type symbols -------------------------------------------
//
// One hinge/pivot/handle glyph per HingedOpeningType icon, transcribed
// from ~/Desktop/hinged_opening_types_svg/*.svg — each source file's
// lines/circles/arcs live inside its own 14..86 "operable pane" square
// (out of a 0..100 viewBox), which is exactly what a sash's own rectMm
// already represents here. So every point below is pre-normalized to
// that square's own 0..1 space ((sourceCoord - 14) / 72) and mapped onto
// the real sash rect at render time — no per-icon coordinate math, one
// mapper for all of them.

type SymbolPoint = readonly [number, number]
type SymbolPrimitive =
  | { t: 'line'; p1: SymbolPoint; p2: SymbolPoint }
  | { t: 'circle'; c: SymbolPoint; r?: number }
  | { t: 'arc'; p0: SymbolPoint; pc: SymbolPoint; p1: SymbolPoint }
  | { t: 'tri'; pts: readonly [SymbolPoint, SymbolPoint, SymbolPoint] }

// 01_top_hung.svg
const TOP_HUNG_SYMBOL: SymbolPrimitive[] = [
  { t: 'line', p1: [0, 1], p2: [0.5, 0] },
  { t: 'line', p1: [1, 1], p2: [0.5, 0] },
  { t: 'circle', c: [0.5, 0] },
]
// 03_side_hung_hinge_left.svg (also 11_single_door_hinge_left.svg —
// byte-identical hinge geometry; "Is door" already covers the sill
// difference, so single-door reuses this rather than a second copy)
const SIDE_HUNG_LEFT_SYMBOL: SymbolPrimitive[] = [
  { t: 'line', p1: [0, 0], p2: [1, 0.5] },
  { t: 'line', p1: [0, 1], p2: [1, 0.5] },
  { t: 'circle', c: [0, 0] },
  { t: 'circle', c: [0, 1] },
]
// 04_side_hung_hinge_right.svg (also 12_single_door_hinge_right.svg)
const SIDE_HUNG_RIGHT_SYMBOL: SymbolPrimitive[] = [
  { t: 'line', p1: [1, 0], p2: [0, 0.5] },
  { t: 'line', p1: [1, 1], p2: [0, 0.5] },
  { t: 'circle', c: [1, 0] },
  { t: 'circle', c: [1, 1] },
]
// 07_pivot_hinge_bottom.svg
const PIVOT_BOTTOM_SYMBOL: SymbolPrimitive[] = [
  { t: 'arc', p0: [0, 0.5], pc: [0.5, 0.25], p1: [1, 0.5] },
  { t: 'line', p1: [0.5, 1], p2: [0, 0.5] },
  { t: 'line', p1: [0.5, 1], p2: [1, 0.5] },
  { t: 'circle', c: [0.5, 1] },
]
// 08_pivot_hinge_side.svg — the two small triangles sit just outside
// the pane edge (normalized x slightly <0 or >1), same as the source.
const PIVOT_SIDE_SYMBOL: SymbolPrimitive[] = [
  { t: 'arc', p0: [0.5, 0], pc: [0.3482, 0.3482], p1: [0, 0.5] },
  { t: 'arc', p0: [0.5, 0], pc: [0.6518, 0.3482], p1: [1, 0.5] },
  { t: 'line', p1: [0.5, 1], p2: [0, 0.5] },
  { t: 'line', p1: [0.5, 1], p2: [1, 0.5] },
  {
    t: 'tri',
    pts: [
      [-0.0139, 0.4444],
      [-0.0139, 0.5556],
      [0.0556, 0.5],
    ],
  },
  {
    t: 'tri',
    pts: [
      [1.0139, 0.4444],
      [1.0139, 0.5556],
      [0.9444, 0.5],
    ],
  },
  { t: 'circle', c: [0.5, 1], r: 0.75 },
]

// Every single-leaf icon (i.e. everything except the double-door family,
// which assembles two of these per-leaf below, and the fixed-mullion
// pair, which draws no hinge symbol at all).
const OPENING_TYPE_SYMBOLS: Partial<Record<HingedOpeningType, SymbolPrimitive[]>> = {
  [HingedOpeningType.TOP_HUNG]: TOP_HUNG_SYMBOL,
  [HingedOpeningType.SIDE_HUNG_LEFT]: SIDE_HUNG_LEFT_SYMBOL,
  [HingedOpeningType.SIDE_HUNG_RIGHT]: SIDE_HUNG_RIGHT_SYMBOL,
  [HingedOpeningType.TILT_TURN_LEFT]: [...TOP_HUNG_SYMBOL, ...SIDE_HUNG_LEFT_SYMBOL],
  [HingedOpeningType.TILT_TURN_RIGHT]: [...TOP_HUNG_SYMBOL, ...SIDE_HUNG_RIGHT_SYMBOL],
  [HingedOpeningType.PIVOT_BOTTOM]: PIVOT_BOTTOM_SYMBOL,
  [HingedOpeningType.PIVOT_SIDE]: PIVOT_SIDE_SYMBOL,
  [HingedOpeningType.SINGLE_DOOR_HINGE_LEFT]: SIDE_HUNG_LEFT_SYMBOL,
  [HingedOpeningType.SINGLE_DOOR_HINGE_RIGHT]: SIDE_HUNG_RIGHT_SYMBOL,
}

const DOUBLE_DOOR_HANDLE_TYPES: HingedOpeningType[] = [
  HingedOpeningType.DOUBLE_DOOR_HANDLES_A,
  HingedOpeningType.DOUBLE_DOOR_HANDLES_B,
]

// 13/14_double_door_handles.svg's small hook at each leaf's meeting
// (inner) edge — simplified to a short tick + nub rather than the
// source's exact `v8 h6` hook, which isn't expressible as the
// point-pairs every other primitive here uses.
function handleNotch(innerEdge: 0 | 1): SymbolPrimitive[] {
  const nub = innerEdge === 1 ? -0.08 : 0.08
  return [
    { t: 'line', p1: [innerEdge, 0.42], p2: [innerEdge, 0.58] },
    { t: 'line', p1: [innerEdge, 0.5], p2: [innerEdge + nub, 0.5] },
  ]
}

function mapSymbolPoint(rect: WindowPart['rectMm'], p: SymbolPoint): [number, number] {
  return [rect.x + p[0] * rect.width, rect.y + p[1] * rect.height]
}

function renderSymbolPrimitives(rect: WindowPart['rectMm'], primitives: SymbolPrimitive[], key: string): React.ReactNode {
  // Scaled to the leaf's own size (not the whole window) so a
  // double-door's half-width leaves get proportionally sized glyphs,
  // not oversized ones.
  const scale = Math.min(rect.width, rect.height)
  const strokeWidth = scale * 0.01
  const dashArray = `${scale * 0.018} ${scale * 0.015}`
  const baseRadius = scale * 0.013
  return (
    <g key={key} stroke="var(--muted-foreground)" fill="none" strokeLinecap="round">
      {primitives.map((p, i) => {
        if (p.t === 'line') {
          const [x1, y1] = mapSymbolPoint(rect, p.p1)
          const [x2, y2] = mapSymbolPoint(rect, p.p2)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={strokeWidth} />
        }
        if (p.t === 'circle') {
          const [cx, cy] = mapSymbolPoint(rect, p.c)
          return <circle key={i} cx={cx} cy={cy} r={baseRadius * (p.r ?? 1)} fill="var(--muted-foreground)" stroke="none" />
        }
        if (p.t === 'arc') {
          const [x0, y0] = mapSymbolPoint(rect, p.p0)
          const [xc, yc] = mapSymbolPoint(rect, p.pc)
          const [x1, y1] = mapSymbolPoint(rect, p.p1)
          return (
            <path
              key={i}
              d={`M${x0} ${y0} Q${xc} ${yc} ${x1} ${y1}`}
              strokeWidth={strokeWidth * 0.85}
              strokeDasharray={dashArray}
            />
          )
        }
        const pts = p.pts.map((pt) => mapSymbolPoint(rect, pt).join(',')).join(' ')
        return <polygon key={i} points={pts} fill="var(--muted-foreground)" stroke="none" />
      })}
    </g>
  )
}

export function renderOpeningTypeSymbols(sashes: WindowPart[], openingType: HingedOpeningType): React.ReactNode {
  if (DOUBLE_DOOR_OPENING_TYPES.includes(openingType) && sashes.length === 2) {
    const withHandles = DOUBLE_DOOR_HANDLE_TYPES.includes(openingType)
    return (
      <>
        {renderSymbolPrimitives(
          sashes[0].rectMm,
          withHandles ? [...SIDE_HUNG_LEFT_SYMBOL, ...handleNotch(1)] : SIDE_HUNG_LEFT_SYMBOL,
          'leaf-0',
        )}
        {renderSymbolPrimitives(
          sashes[1].rectMm,
          withHandles ? [...SIDE_HUNG_RIGHT_SYMBOL, ...handleNotch(0)] : SIDE_HUNG_RIGHT_SYMBOL,
          'leaf-1',
        )}
      </>
    )
  }
  const primitives = OPENING_TYPE_SYMBOLS[openingType]
  if (!primitives || sashes.length === 0) return null
  return renderSymbolPrimitives(sashes[0].rectMm, primitives, 'leaf-0')
}
// ---- Hardware -----------------------------------------------------------
//
// Real barrel hinges and a handle, sized in mm from `ProfileMetrics.
// hardware`, drawn on top of the schematic opening-type symbols above
// (docs/elevation_detail_planing.md §4, decision 6). Barrels only —
// the hinge leaves are concealed in the rebate. Fixed neutral greys:
// hardware doesn't take the frame finish. Not mirrored for RTL — the
// drawing is `dir="ltr"` because hinge side is real information.

export const HINGE_BARREL_FILL = '#5c6169'
export const HARDWARE_PLATE_FILL = '#3a3e44'

type Side = 'left' | 'right' | 'top' | 'bottom'

export type HardwareItem =
  | { kind: 'hinge'; rect: WindowPart['rectMm']; axis: 'vertical' | 'horizontal'; knuckles: number }
  | { kind: 'handle'; plate: WindowPart['rectMm']; lever: WindowPart['rectMm'] }
  // Sliding-only (docs/sliding_windows_planing.md §13):
  /** A flush hook-lock handle: recessed body, grip, and the hook latch
   * pointing at the interlock (`hookSide`). */
  | { kind: 'flushLock'; rect: WindowPart['rectMm']; hookSide: 'left' | 'right' }
  /** A key cylinder under a lever handle. */
  | { kind: 'cylinder'; cx: number; cy: number; r: number }

/** Barrels along one edge of the sash, centred on the frame/sash
 * junction. Vertical stiles get 3 at 13 / 50 / 87 % of the height, or
 * 2 at 16 / 84 % on a sash under 900 mm; a rail always gets 2 at
 * 16 / 84 % of the width. `knuckles` 0 draws a plain pivot pin. */
function hingesAlong(
  sash: WindowPart['rectMm'],
  side: Side,
  hw: ProfileMetrics['hardware'],
  pin = false,
): HardwareItem[] {
  const length = pin ? hw.hingeLength / 3 : hw.hingeLength
  const width = hw.hingeWidth
  const vertical = side === 'left' || side === 'right'
  const span = vertical ? sash.height : sash.width
  const fractions = pin ? [0.5] : vertical && span >= 900 ? [0.13, 0.5, 0.87] : [0.16, 0.84]
  const edge =
    side === 'left' ? sash.x : side === 'right' ? sash.x + sash.width : side === 'top' ? sash.y : sash.y + sash.height
  return fractions.map((f) => {
    const centre = (vertical ? sash.y : sash.x) + span * f
    return {
      kind: 'hinge',
      axis: vertical ? 'vertical' : 'horizontal',
      knuckles: pin ? 0 : 3,
      rect: vertical
        ? { x: edge - width / 2, y: centre - length / 2, width, height: length }
        : { x: centre - length / 2, y: edge - width / 2, width: length, height: width },
    }
  })
}

/** A handle centred on one member of the sash: the backplate sits on
 * the middle of that stile/rail, the lever hangs from its centre —
 * down on a stile, inward along a rail. */
function handleOn(sash: WindowPart['rectMm'], side: Side, sashFace: number, hw: ProfileMetrics['hardware']): HardwareItem {
  const leverWidth = hw.handlePlateWidth * 0.45
  if (side === 'left' || side === 'right') {
    const cx = side === 'left' ? sash.x + sashFace / 2 : sash.x + sash.width - sashFace / 2
    const cy = sash.y + sash.height / 2
    return {
      kind: 'handle',
      plate: { x: cx - hw.handlePlateWidth / 2, y: cy - hw.handlePlateHeight / 2, width: hw.handlePlateWidth, height: hw.handlePlateHeight },
      lever: { x: cx - leverWidth / 2, y: cy, width: leverWidth, height: hw.handleLeverLength },
    }
  }
  const cy = side === 'top' ? sash.y + sashFace / 2 : sash.y + sash.height - sashFace / 2
  const cx = sash.x + sash.width / 2
  return {
    kind: 'handle',
    plate: { x: cx - hw.handlePlateHeight / 2, y: cy - hw.handlePlateWidth / 2, width: hw.handlePlateHeight, height: hw.handlePlateWidth },
    lever: { x: cx, y: cy - leverWidth / 2, width: hw.handleLeverLength, height: leverWidth },
  }
}

// ---- Sliding hardware (docs/sliding_windows_planing.md §13) --------------
//
// Mario's rule, 2026-09-20/21 (settled over four rounds): ONE lock
// position per section, nothing else — no pulls. It hinges on the
// CENTRE of the layout, not on the sash count: when two sashes meet in
// the middle ON THE SAME RAIL (edge to edge — `[0, 1, 1, 0]`, `[1, 0,
// 0, 1]`), the left one of that pair gets a lever + key cylinder on its
// centre stile. Otherwise — a single sash in the middle, or a centre
// pair on different rails that overlap at an interlock (`[0, 1, 0]`,
// `[0, 1]`, `[0, 1, 0, 1]`) — the far left and far right sashes lock
// INTO THE FRAME: a flush hook-lock on the stile closest to the frame.
// "We can't add both in centre and far left/right, only one of them."
// Interior face only (the drawing is always the interior for now —
// `DRAWING_FACE`). Sizes derive from the same `ProfileMetrics.hardware`
// the hinged lever uses.

const stileCentre = (sash: WindowPart['rectMm'], side: 'left' | 'right', sashFace: number) =>
  side === 'left' ? sash.x + sashFace / 2 : sash.x + sash.width - sashFace / 2

function flushLockOn(sash: WindowPart['rectMm'], side: 'left' | 'right', sashFace: number, hw: ProfileMetrics['hardware']): HardwareItem {
  const width = hw.handlePlateWidth * 1.06
  const height = hw.handlePlateHeight * 1.13
  const cx = stileCentre(sash, side, sashFace)
  const cy = sash.y + sash.height / 2
  return { kind: 'flushLock', rect: { x: cx - width / 2, y: cy - height / 2, width, height }, hookSide: side }
}

function leverLockOn(sash: WindowPart['rectMm'], side: 'left' | 'right', sashFace: number, hw: ProfileMetrics['hardware']): HardwareItem[] {
  const handle = handleOn(sash, side, sashFace, hw)
  const cx = stileCentre(sash, side, sashFace)
  const cy = sash.y + sash.height / 2 + hw.handlePlateHeight / 2 + hw.handlePlateWidth * 1.05
  return [handle, { kind: 'cylinder', cx, cy, r: hw.handlePlateWidth * 0.44 }]
}

/**
 * One SECTION's sliding hardware — `sashes` are that section's laid-out
 * sash parts (any order; sorted by `index` here). Interior face only;
 * the exterior would show nothing.
 */
export function slidingHardwareFor(sashes: WindowPart[], face: DrawingFace, metrics: ProfileMetrics): HardwareItem[] {
  const ordered = [...sashes].filter((s) => s.sliding).sort((a, b) => a.index - b.index)
  const n = ordered.length
  if (face !== 'interior' || n < 2) return []
  const hw = metrics.hardware
  const sashFace = metrics.sashFace
  if (n % 2 === 0) {
    const left = ordered[n / 2 - 1]
    const right = ordered[n / 2]
    if (left.sliding?.rail === right.sliding?.rail) return leverLockOn(left.rectMm, 'right', sashFace, hw)
  }
  return [flushLockOn(ordered[0].rectMm, 'left', sashFace, hw), flushLockOn(ordered[n - 1].rectMm, 'right', sashFace, hw)]
}

/** Every laid-out sliding sash's hardware for the panel, grouped per
 * section (the lock rule counts sashes within ONE section). */
export function renderSlidingHardware(sashes: WindowPart[], face: DrawingFace, metrics: ProfileMetrics): React.ReactNode {
  const bySection = new Map<number, WindowPart[]>()
  for (const sash of sashes) {
    if (!sash.sliding) continue
    const key = sash.sectionIndex ?? -1
    bySection.set(key, [...(bySection.get(key) ?? []), sash])
  }
  return (
    <>
      {Array.from(bySection.entries()).map(([sectionIndex, group]) =>
        renderHardwareItems(slidingHardwareFor(group, face, metrics), `sliding-hw-${sectionIndex}`),
      )}
    </>
  )
}

/**
 * Where this sash's hinges and handle go for its opening type — the
 * §4 table. `leaf` picks a double door's side: each leaf is hinged on
 * its OUTER stile with the handles meeting in the middle. Empty for
 * fixed, fixed-mullion and anything that isn't a hinged opening type.
 */
export function hardwareFor(
  openingType: HingedOpeningType,
  sash: WindowPart['rectMm'],
  metrics: ProfileMetrics,
  leaf: 0 | 1 = 0,
): HardwareItem[] {
  const hw = metrics.hardware
  const face = metrics.sashFace
  switch (openingType) {
    case HingedOpeningType.SIDE_HUNG_LEFT:
    case HingedOpeningType.TILT_TURN_LEFT:
    case HingedOpeningType.SINGLE_DOOR_HINGE_LEFT:
      return [...hingesAlong(sash, 'left', hw), handleOn(sash, 'right', face, hw)]
    case HingedOpeningType.SIDE_HUNG_RIGHT:
    case HingedOpeningType.TILT_TURN_RIGHT:
    case HingedOpeningType.SINGLE_DOOR_HINGE_RIGHT:
      return [...hingesAlong(sash, 'right', hw), handleOn(sash, 'left', face, hw)]
    case HingedOpeningType.TOP_HUNG:
      return [...hingesAlong(sash, 'top', hw), handleOn(sash, 'bottom', face, hw)]
    case HingedOpeningType.PIVOT_BOTTOM:
      // Horizontal axis: a pin on each stile at mid-height, handle on
      // the bottom rail.
      return [...hingesAlong(sash, 'left', hw, true), ...hingesAlong(sash, 'right', hw, true), handleOn(sash, 'bottom', face, hw)]
    case HingedOpeningType.PIVOT_SIDE:
      // Vertical axis: a pin on the top and bottom rails at mid-width,
      // handle on the right stile.
      return [...hingesAlong(sash, 'top', hw, true), ...hingesAlong(sash, 'bottom', hw, true), handleOn(sash, 'right', face, hw)]
    case HingedOpeningType.DOUBLE_DOOR_FRENCH_A:
    case HingedOpeningType.DOUBLE_DOOR_FRENCH_B:
    case HingedOpeningType.DOUBLE_DOOR_HANDLES_A:
    case HingedOpeningType.DOUBLE_DOOR_HANDLES_B:
      return leaf === 0
        ? [...hingesAlong(sash, 'left', hw), handleOn(sash, 'right', face, hw)]
        : [...hingesAlong(sash, 'right', hw), handleOn(sash, 'left', face, hw)]
    default:
      return []
  }
}

function renderHardwareItems(items: HardwareItem[], key: string): React.ReactNode {
  return (
    <g key={key}>
      {items.map((item, i) => {
        if (item.kind === 'hinge') {
          const r = item.rect
          const short = Math.min(r.width, r.height)
          // Knuckle joints: the two lines splitting a three-knuckle
          // barrel, across its short axis.
          const joints = Array.from({ length: Math.max(item.knuckles - 1, 0) }, (_, j) => (j + 1) / item.knuckles)
          return (
            <g key={i}>
              <rect x={r.x} y={r.y} width={r.width} height={r.height} rx={short / 2} fill={HINGE_BARREL_FILL} />
              {joints.map((f) =>
                item.axis === 'vertical' ? (
                  <line key={f} x1={r.x} y1={r.y + r.height * f} x2={r.x + r.width} y2={r.y + r.height * f} stroke={HARDWARE_PLATE_FILL} strokeWidth={short * 0.12} />
                ) : (
                  <line key={f} x1={r.x + r.width * f} y1={r.y} x2={r.x + r.width * f} y2={r.y + r.height} stroke={HARDWARE_PLATE_FILL} strokeWidth={short * 0.12} />
                ),
              )}
            </g>
          )
        }
        if (item.kind === 'flushLock') {
          const r = item.rect
          const pad = r.width * 0.18
          const dir = item.hookSide === 'right' ? 1 : -1
          const hookX = item.hookSide === 'right' ? r.x + r.width - pad * 0.7 : r.x + pad * 0.7
          const hookY = r.y + r.height * 0.78
          const hookLen = r.width * 0.65
          const hookR = r.width * 0.3
          return (
            <g key={i}>
              <rect x={r.x} y={r.y} width={r.width} height={r.height} rx={r.width * 0.18} fill={HARDWARE_PLATE_FILL} />
              <rect x={r.x + pad} y={r.y + pad} width={r.width - 2 * pad} height={r.height * 0.55} rx={r.width * 0.12} fill={HINGE_BARREL_FILL} />
              <path
                d={`M${hookX - dir * hookLen * 0.45} ${hookY} h${dir * hookLen} a${hookR} ${hookR} 0 0 ${dir > 0 ? 1 : 0} 0 ${hookR * 2} h${-dir * hookLen * 0.55}`}
                fill="none"
                stroke={HINGE_BARREL_FILL}
                strokeWidth={r.width * 0.17}
                strokeLinecap="round"
              />
              <circle cx={r.x + r.width / 2} cy={r.y + r.height - pad * 1.4} r={r.width * 0.2} fill={HINGE_BARREL_FILL} />
            </g>
          )
        }
        if (item.kind === 'cylinder') {
          return (
            <g key={i}>
              <circle cx={item.cx} cy={item.cy} r={item.r} fill={HARDWARE_PLATE_FILL} />
              <rect x={item.cx - item.r * 0.2} y={item.cy - item.r * 0.7} width={item.r * 0.4} height={item.r * 1.4} rx={item.r * 0.2} fill={HINGE_BARREL_FILL} />
            </g>
          )
        }
        const { plate, lever } = item
        const leverRadius = Math.min(lever.width, lever.height) / 2
        return (
          <g key={i}>
            <rect x={plate.x} y={plate.y} width={plate.width} height={plate.height} rx={Math.min(plate.width, plate.height) * 0.15} fill={HARDWARE_PLATE_FILL} />
            <rect x={lever.x} y={lever.y} width={lever.width} height={lever.height} rx={leverRadius} fill={HINGE_BARREL_FILL} />
          </g>
        )
      })}
    </g>
  )
}

/** Every sash's hardware for the panel — the one call the interactive
 * drawing makes, mirroring `renderOpeningTypeSymbols`' contract. A
 * double door's two leaves each get their own side. */
export function renderHardware(sashes: WindowPart[], openingType: HingedOpeningType, metrics: ProfileMetrics): React.ReactNode {
  if (DOUBLE_DOOR_OPENING_TYPES.includes(openingType) && sashes.length === 2) {
    return (
      <>
        {renderHardwareItems(hardwareFor(openingType, sashes[0].rectMm, metrics, 0), 'leaf-0')}
        {renderHardwareItems(hardwareFor(openingType, sashes[1].rectMm, metrics, 1), 'leaf-1')}
      </>
    )
  }
  if (sashes.length === 0) return null
  return renderHardwareItems(hardwareFor(openingType, sashes[0].rectMm, metrics), 'leaf-0')
}

// ---- Sliding -------------------------------------------------------------
//
// docs/sliding_windows_planing.md §5. A sliding section's sashes carry
// `sliding: { rail, openingType }` from the geometry (rail 0 = outside,
// the highest rail = inside); everything FACE-relative — which sash is
// nearer the viewer, which edge is hidden, how heavy an outline — is
// derived here from the face being painted, so the stored layout never
// has to know which side the user is looking from. Legacy sliding
// sections (no layout yet) have no `sliding` on their parts and keep
// their old paint order: the right leaf over the left.

export type DrawingFace = 'interior' | 'exterior'

/** 0 = furthest from the viewer … `rails - 1` = nearest. Interior view:
 * the front (inside) rail is nearest; exterior view: rail 0 is. */
function railNearness(rail: number, rails: number, face: DrawingFace): number {
  return face === 'interior' ? rail : rails - 1 - rail
}

/** The frame profile's rail count, widened to cover any sash sitting
 * beyond it (a `railOutOfRange` layout still has to draw so the user
 * can see which sash to move); the sashes alone when no count is known. */
function railCountOf(sashes: WindowPart[], rails: number | undefined): number {
  let max = 0
  for (const sash of sashes) if (sash.sliding && sash.sliding.rail > max) max = sash.sliding.rail
  return Math.max(rails ?? 0, max + 1)
}

/** The order to PAINT a panel's sashes so a nearer sash covers a
 * further one: further rails first. Sashes without sliding info keep
 * their relative order (a stable sort on nearness 0), which for a
 * legacy two-leaf sliding section is exactly the old right-over-left. */
export function slidingPaintOrder(sashes: WindowPart[], face: DrawingFace, rails?: number): WindowPart[] {
  const count = railCountOf(sashes, rails)
  return sashes
    .map((sash, order) => ({ sash, order, near: sash.sliding ? railNearness(sash.sliding.rail, count, face) : 0 }))
    .sort((a, b) => a.near - b.near || a.order - b.order)
    .map((entry) => entry.sash)
}

/** Outline weight multiplier for a sash: the nearest rail reads
 * heaviest (the prototype's `strokeFor`), the furthest at the panel's
 * base weight. 1 for anything that isn't a laid-out sliding sash. */
export function slidingStrokeScale(sash: WindowPart, face: DrawingFace, rails?: number, allSashes?: WindowPart[]): number {
  if (!sash.sliding) return 1
  const count = railCountOf(allSashes ?? [sash], rails)
  if (count <= 1) return 1
  return 1 + (railNearness(sash.sliding.rail, count, face) / (count - 1)) * 0.6
}

export interface HiddenEdge {
  key: string
  x: number
  y1: number
  y2: number
}

/** Where a further sash's vertical edge runs BEHIND its nearer
 * neighbour's stile — drawn as a dashed hairline on top of everything,
 * the technical-drawing convention for a hidden line. One per pair of
 * adjacent sashes on different rails, per section. */
export function slidingHiddenEdges(sashes: WindowPart[], face: DrawingFace, rails: number | undefined, inset: number): HiddenEdge[] {
  const count = railCountOf(sashes, rails)
  const bySection = new Map<number, WindowPart[]>()
  for (const sash of sashes) {
    if (!sash.sliding) continue
    const key = sash.sectionIndex ?? -1
    bySection.set(key, [...(bySection.get(key) ?? []), sash])
  }
  const edges: HiddenEdge[] = []
  for (const group of bySection.values()) {
    const ordered = [...group].sort((a, b) => a.index - b.index)
    for (let i = 0; i < ordered.length - 1; i++) {
      const left = ordered[i]
      const right = ordered[i + 1]
      if (!left.sliding || !right.sliding || left.sliding.rail === right.sliding.rail) continue
      const leftNearer = railNearness(left.sliding.rail, count, face) > railNearness(right.sliding.rail, count, face)
      // The further sash's edge is the one that disappears: the left
      // sash's right edge under the right sash's stile, or vice versa.
      const x = leftNearer ? right.rectMm.x : left.rectMm.x + left.rectMm.width
      const behind = leftNearer ? right : left
      edges.push({ key: `${left.id}|${right.id}`, x, y1: behind.rectMm.y + inset, y2: behind.rectMm.y + behind.rectMm.height - inset })
    }
  }
  return edges
}

/** The fixed-glazing mark: a dashed `+` centred on each pane whose
 * section has no sash (a hinged Fixed section, a sliding section set
 * to Fixed, a curtain-wall light). The elevation-drawing convention
 * for "this one doesn't open", so a fixed light beside an opening one
 * reads as fixed at a glance instead of merely symbol-less. Blue on
 * purpose (the user's call) — unlike the muted-grey hinge/slide
 * symbols it's the one annotation that must pop against the glass
 * tint on a drawing full of grey seams. */
/** The fixed mark and the sliding arrows are blue (Mario's call) so the
 * "what this section does" annotations stand out from the grey seams,
 * gaskets and hardware they sit among. Hinged hinge/pivot symbols keep
 * the muted grey — "leave hinged as is". */
export const SYMBOL_STROKE_BLUE = '#2563eb'

export function renderFixedSymbols(glasses: WindowPart[]): React.ReactNode {
  if (glasses.length === 0) return null
  return (
    <g stroke={SYMBOL_STROKE_BLUE} fill="none" strokeLinecap="round">
      {glasses.map((glass) => {
        const { x, y, width, height } = glass.rectMm
        const scale = Math.min(width, height)
        // Kept inside the pane's middle 40% vertically so it clears the
        // section letter sitting in the bottom band of a shallow transom,
        // and capped in mm so a big picture window gets a mark, not a
        // crosshair the size of a door.
        const arm = Math.min(width * 0.28, height * 0.2, 150)
        // Clamped so a shallow transom's mark keeps the same line weight
        // as the big lights next to it, and a big light doesn't fatten.
        const strokeWidth = Math.min(Math.max(scale * 0.024, 12), 14)
        const cx = x + width / 2
        const cy = y + height / 2
        return (
          <g key={glass.id} strokeWidth={strokeWidth} strokeDasharray={`${strokeWidth * 2.5} ${strokeWidth * 1.7}`}>
            <line x1={cx - arm} y1={cy} x2={cx + arm} y2={cy} />
            <line x1={cx} y1={cy - arm} x2={cx} y2={cy + arm} />
          </g>
        )
      })}
    </g>
  )
}

/** One horizontal arrow per laid-out sliding sash, centred in its
 * leaf, pointing the way(s) it slides — `←`, `→` or `↔` from the
 * resolved opening type. Sized from the leaf's own shorter side so a
 * tall narrow sash gets a compact arrow, not a skewed one (which is why
 * this isn't a `SymbolPrimitive` table — those scale x and y
 * independently). Blue like the fixed mark, not the hinge grey. */
export function renderSlidingSymbols(sashes: WindowPart[]): React.ReactNode {
  return (
    <g stroke={SYMBOL_STROKE_BLUE} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {sashes.map((sash) => {
        if (!sash.sliding) return null
        const { x, y, width, height } = sash.rectMm
        const scale = Math.min(width, height)
        const len = Math.min(width * 0.28, height * 0.14)
        const head = Math.min(len * 0.3, scale * 0.08)
        const cx = x + width / 2
        const cy = y + height / 2
        const x1 = cx - len / 2
        const x2 = cx + len / 2
        const strokeWidth = scale * 0.012
        const type = sash.sliding.openingType
        return (
          <g key={sash.id} strokeWidth={strokeWidth}>
            <line x1={x1} y1={cy} x2={x2} y2={cy} />
            {movesLeft(type) && <path d={`M${x1 + head} ${cy - head} L${x1} ${cy} L${x1 + head} ${cy + head}`} />}
            {movesRight(type) && <path d={`M${x2 - head} ${cy - head} L${x2} ${cy} L${x2 - head} ${cy + head}`} />}
          </g>
        )
      })}
    </g>
  )
}
