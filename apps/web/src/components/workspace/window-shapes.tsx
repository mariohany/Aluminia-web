import { SystemType } from '@repo/types/lookups'
import { HingedOpeningType } from '@repo/types/windows'
import { DOUBLE_DOOR_OPENING_TYPES, type WindowPart } from '@/lib/window-geometry'

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