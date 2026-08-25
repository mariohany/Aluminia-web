import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { SystemType } from '@repo/types/lookups'
import { HingedOpeningType } from '@repo/types/windows'
import {
  DOUBLE_DOOR_OPENING_TYPES,
  NOMINAL_FRAME_FACE_MM,
  NOMINAL_MULLION_BAR_MM,
  NOMINAL_SASH_FACE_MM,
  type WindowLayout,
  type WindowPart,
} from '@/lib/window-geometry'
import type { TranslatedIssue } from '@/lib/window-weight'

// Base (no-colour) glass tint — opaque here, thinned separately by
// `GLASS_FILL_OPACITY` so a real colour (see `glassHex` below) can share
// the exact same translucency instead of needing its own baked-in alpha.
const DEFAULT_GLASS_FILL = 'oklch(0.75 0.06 230)'
const GLASS_FILL_OPACITY = 0.35
const MESH_STROKE = 'var(--muted-foreground)'
const ERROR_COLOR = 'var(--destructive)'
const WARNING_COLOR = 'oklch(0.72 0.15 75)'
/** Default outline on every shape (frame/sash/glass) — replaced by the
 * selected/issue colour when either applies. */
const DEFAULT_STROKE = 'var(--border)'

export interface WindowDrawingProps {
  layout: WindowLayout
  systemType: SystemType | null
  /** Whether a frame profile has actually been picked. Before that,
   * `systemType` is still just "not sliding", not a real fact about how
   * the window opens — the hinge direction chevron is suppressed until
   * this is true, even though the sash/glass placeholder pane itself
   * still draws (window-geometry.ts always builds one). */
  hasFrame: boolean
  /** A hinged door has no sill — its frame is drawn open at the bottom (no fill, no stroke there). No-op for every other systemType. */
  isDoor: boolean
  /** Which icon was picked in the Design step's "Type" grid — `null` for
   * sliding/curtain_wall or a hinged window nobody has picked one for
   * yet. Drives the hinge/pivot symbol drawn on the sash, and for the
   * double-door/fixed-mullion families also which structural shape
   * `layout` itself already is (window-geometry.ts). */
  openingType: HingedOpeningType | null
  /** Hex of the face currently shown (the interior/exterior toggle lives above the drawing, not in it). `null` falls back to a neutral aluminium grey. */
  frameHex: string | null
  /** Hex of the selected glass's own colour — only a glass *combination*
   * has one (a coloured sheet in its build-up); a plain single-pane
   * glass has no colour field, so this is `null` and the glass keeps
   * its default neutral tint. */
  glassHex: string | null
  /** A Georgian spacer bar grid embedded in the glass build-up — drawn
   * as bars over every glass pane when set. `null` when the selected
   * glass has no Georgian gap (a plain single-pane glass never does). */
  georgianGrid: { columns: number; rows: number } | null
  selectedPartId: string | null
  hoveredPartId: string | null
  onSelect: (partId: string) => void
  onHover: (partId: string | null) => void
  widthMm: number
  heightMm: number
  onWidthChange: (mm: number) => void
  onHeightChange: (mm: number) => void
  /** aria-labels for the two dimension inputs — translated by the caller (`t('fields.widthMm')`/`t('fields.heightMm')`), since this component takes no i18n dependency of its own. */
  widthLabel: string
  heightLabel: string
  /** Already-translated messages, keyed by part id — window-dialog.tsx builds this from `collectWindowIssues()` (apps/web/src/lib/window-weight.ts). */
  issuesByPart: Map<string, TranslatedIssue[]>
}

function worstSeverity(issues: TranslatedIssue[] | undefined): TranslatedIssue['severity'] | null {
  if (!issues || issues.length === 0) return null
  return issues.some((i) => i.severity === 'error') ? 'error' : 'warning'
}

/**
 * Pure presentational elevation. All geometry comes from
 * `buildWindowLayout()` (apps/web/src/lib/window-geometry.ts) — nothing
 * here is computed beyond pixel-space derived from it. Selection/hover
 * state and the width/height values are owned by `WindowDialog`.
 */
export function WindowDrawing({
  layout,
  systemType,
  hasFrame,
  isDoor,
  openingType,
  frameHex,
  glassHex,
  georgianGrid,
  selectedPartId,
  hoveredPartId,
  onSelect,
  onHover,
  widthMm,
  heightMm,
  onWidthChange,
  onHeightChange,
  widthLabel,
  heightLabel,
  issuesByPart,
}: WindowDrawingProps) {
  const { outerMm, parts } = layout
  const margin = Math.max(outerMm.width, outerMm.height) * 0.14
  const viewBox = { minX: -margin, minY: -margin, width: outerMm.width + margin * 2, height: outerMm.height + margin * 2 }
  const meshCell = Math.max(outerMm.width, outerMm.height) * 0.02
  const tickLen = margin * 0.18
  const glyphRadius = Math.max(outerMm.width, outerMm.height) * 0.018
  // The thin outline every shape (frame/sash/glass) gets around its own
  // edges — gray by default, orange (primary) once selected.
  const strokeWeight = Math.max(outerMm.width, outerMm.height) * 0.0028
  // A Georgian bar reads as a slim version of the frame/sash face, not a
  // hairline — same material colour (frameFill, below), just thinner.
  const georgianBarWidth = Math.max(outerMm.width, outerMm.height) * 0.012
  // A fixed-mullion bar, unlike a Georgian one, has a real mm width
  // already baked into the geometry (it's the actual gap
  // window-geometry.ts split the two lights by) — draw it at that exact
  // width rather than a proportional guess, or it won't line up with
  // the gap between the two glass rects.
  const mullionBarWidth = NOMINAL_MULLION_BAR_MM

  // Which axis a fixed-mullion opening type splits its one light on —
  // `null` for every other type, including double-door (that one gets
  // two real sashes from window-geometry.ts instead, no bar to draw).
  const mullionGrid =
    openingType === HingedOpeningType.FIXED_VERTICAL_MULLION
      ? { columns: 2, rows: 1 }
      : openingType === HingedOpeningType.FIXED_HORIZONTAL_MULLION
        ? { columns: 1, rows: 2 }
        : null

  const frame = parts.find((p) => p.kind === 'frame')
  const sashes = parts.filter((p) => p.kind === 'sash')
  const glasses = parts.filter((p) => p.kind === 'glass')
  const flyScreen = parts.find((p) => p.kind === 'flyScreen')
  const flyScreenHandleRect = flyScreen && {
    x: flyScreen.rectMm.x + flyScreen.rectMm.width / 2 - meshCell * 1.8,
    y: flyScreen.rectMm.y + flyScreen.rectMm.height - meshCell * 0.8,
    width: meshCell * 3.6,
    height: meshCell * 1.6,
  }
  // Only hinged windows expose the door checkbox — see showDoor in
  // window-dialog.tsx.
  const isDoorHinged = isDoor && systemType === SystemType.HINGED

  // The frame's own opening — the union of all sashes always exactly
  // fills this rect (see buildSlidingSashRects's own interlock math),
  // so it doubles as the frame ring's inner boundary regardless of
  // systemType, without needing a dedicated WindowPart for it. A hinged
  // door drops the bottom inset (see NOMINAL_FRAME_FACE_MM's
  // window-geometry.ts twin adjustment) so it lines up with the now
  // flush-to-the-bottom sash/glass this same isDoorHinged case produces
  // there.
  const frameOpening = frame && {
    x: frame.rectMm.x + NOMINAL_FRAME_FACE_MM,
    y: frame.rectMm.y + NOMINAL_FRAME_FACE_MM,
    width: frame.rectMm.width - 2 * NOMINAL_FRAME_FACE_MM,
    height: frame.rectMm.height - NOMINAL_FRAME_FACE_MM - (isDoorHinged ? 0 : NOMINAL_FRAME_FACE_MM),
  }

  // White powder-coat is the real-world default finish, not just a
  // placeholder — a new window starts with no interior/exterior colour
  // chosen, and the frame/sash should read as white (not a dark
  // fallback) until one is picked. Literal, not a theme token: this is
  // the aluminium's own colour, independent of light/dark UI mode.
  const frameFill = frameHex ?? '#FFFFFF'
  const meshPatternId = 'window-drawing-mesh'

  const svgRef = useRef<SVGSVGElement>(null)
  const transform = useSvgToClientTransform(svgRef, viewBox)

  const topLineY = -margin * 0.5
  const leftLineX = -margin * 0.5

  return (
    // A technical elevation has real left/right meaning (hinge side,
    // which sash overlaps which) — it must not mirror in RTL, unlike
    // the rest of the dialog. See docs/window_design_planing.md's
    // rejected-alternatives note.
    <div dir="ltr" className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
        className="h-full max-h-full w-full max-w-full"
        role="img"
        aria-label={`${Math.round(outerMm.width)} × ${Math.round(outerMm.height)} mm`}
      >
        <defs>
          <pattern id={meshPatternId} width={meshCell} height={meshCell} patternUnits="userSpaceOnUse">
            <path
              d={`M0 0 L${meshCell} ${meshCell} M${meshCell} 0 L0 ${meshCell}`}
              stroke={MESH_STROKE}
              strokeWidth={meshCell * 0.08}
            />
          </pattern>
        </defs>

        {/* Overall dimension lines — always visible, not interactive; the
            numbers themselves are edited via the HTML inputs overlaid
            below, not drawn as SVG text. */}
        <g stroke="var(--muted-foreground)" strokeWidth={Math.max(outerMm.width, outerMm.height) * 0.0018} opacity={0.6}>
          <line x1={0} y1={topLineY} x2={outerMm.width} y2={topLineY} />
          <line x1={0} y1={topLineY - tickLen / 2} x2={0} y2={topLineY + tickLen / 2} />
          <line x1={outerMm.width} y1={topLineY - tickLen / 2} x2={outerMm.width} y2={topLineY + tickLen / 2} />
          <line x1={leftLineX} y1={0} x2={leftLineX} y2={outerMm.height} />
          <line x1={leftLineX - tickLen / 2} y1={0} x2={leftLineX + tickLen / 2} y2={0} />
          <line x1={leftLineX - tickLen / 2} y1={outerMm.height} x2={leftLineX + tickLen / 2} y2={outerMm.height} />
        </g>

        {frame && frameOpening && (
          <InteractivePart
            part={frame}
            selected={selectedPartId === frame.id}
            hovered={hoveredPartId === frame.id}
            onSelect={onSelect}
            onHover={onHover}
            issues={issuesByPart.get(frame.id)}
            glyphRadius={glyphRadius}
            showOverlay={false}
          >
            {/* A filled ring (outer frame rect minus the opening,
                evenodd) rather than a centered stroke — the frame reads
                as a solid bar all the way to the sash, not a thin line
                floating in the middle of a gap. */}
            <path
              d={isDoorHinged ? openBottomFramePath(frame.rectMm, frameOpening) : ringPath(frame.rectMm, frameOpening)}
              fillRule="evenodd"
              fill={frameFill}
              stroke={partStroke(selectedPartId === frame.id, issuesByPart.get(frame.id))}
              strokeWidth={strokeWeight}
            />
          </InteractivePart>
        )}

        {/* The fly-screen mesh is visual only (pointer-events none) — for
            a hinged/curtain-wall window it fully overlaps the sash/glass
            rect (per the user's own "fill the whole frame" call), so the
            actual hit target is the small handle drawn on top of
            everything else, below. */}
        {flyScreen && (
          <rect
            x={flyScreen.rectMm.x}
            y={flyScreen.rectMm.y}
            width={flyScreen.rectMm.width}
            height={flyScreen.rectMm.height}
            fill={`url(#${meshPatternId})`}
            stroke={MESH_STROKE}
            strokeWidth={NOMINAL_SASH_FACE_MM * 0.25}
            opacity={0.85}
            pointerEvents="none"
          />
        )}

        {sashes.map((sash) => {
          // Each sash's own ring runs from its outer rect in to the
          // union of its matching glass panes (same index — sliding's
          // two sashes each hold their own pane; a fixed-mullion opening
          // type gives a single sash TWO panes sharing its index, split
          // by the mullion bar, so the ring's own hole has to span both,
          // not just whichever one `.find()` would happen to hit first)
          // — same "filled bar, not a centered line" treatment as the
          // frame above.
          const glassesForSash = glasses.filter((g) => g.index === sash.index)
          if (glassesForSash.length === 0) return null
          const opening = boundingRect(glassesForSash.map((g) => g.rectMm))
          return (
            <InteractivePart
              key={sash.id}
              part={sash}
              selected={selectedPartId === sash.id}
              hovered={hoveredPartId === sash.id}
              onSelect={onSelect}
              onHover={onHover}
              issues={issuesByPart.get(sash.id)}
              glyphRadius={glyphRadius}
              showOverlay={false}
            >
              <path
                d={ringPath(sash.rectMm, opening)}
                fillRule="evenodd"
                fill={frameFill}
                stroke={partStroke(selectedPartId === sash.id, issuesByPart.get(sash.id))}
                strokeWidth={strokeWeight}
              />
              {mullionGrid && glassesForSash.length > 1 && (
                <g pointerEvents="none">{georgianBars(opening, mullionGrid, mullionBarWidth, frameFill)}</g>
              )}
            </InteractivePart>
          )
        })}

        {glasses.map((glass) => (
          <InteractivePart
            key={glass.id}
            part={glass}
            selected={selectedPartId === glass.id}
            hovered={hoveredPartId === glass.id}
            onSelect={onSelect}
            onHover={onHover}
            issues={issuesByPart.get(glass.id)}
            glyphRadius={glyphRadius}
            showOverlay={false}
          >
            <rect
              x={glass.rectMm.x}
              y={glass.rectMm.y}
              width={glass.rectMm.width}
              height={glass.rectMm.height}
              fill={glassHex ?? DEFAULT_GLASS_FILL}
              fillOpacity={GLASS_FILL_OPACITY}
              stroke={partStroke(selectedPartId === glass.id, issuesByPart.get(glass.id))}
              strokeWidth={strokeWeight}
            />
            {georgianGrid && (
              <g pointerEvents="none">
                {georgianBars(glass.rectMm, georgianGrid, georgianBarWidth, frameFill)}
              </g>
            )}
          </InteractivePart>
        ))}

        {hasFrame && systemType === SystemType.HINGED && openingType && (
          <g pointerEvents="none">{renderOpeningTypeSymbols(sashes, openingType)}</g>
        )}

        {/* The fly screen's own hit target — a small pull-handle glyph
            at the bottom edge of its rect, always on top so it stays
            reachable. Its hit box (ringRect) is deliberately just the
            handle itself, not the full mesh rect — the mesh fully
            overlaps the sash/glass beneath it for a hinged/curtain-wall
            window, and a full-rect hit box there would swallow every
            click meant for them. */}
        {flyScreen && flyScreenHandleRect && (
          <InteractivePart
            part={flyScreen}
            selected={selectedPartId === flyScreen.id}
            hovered={hoveredPartId === flyScreen.id}
            onSelect={onSelect}
            onHover={onHover}
            ringRect={flyScreenHandleRect}
            issues={issuesByPart.get(flyScreen.id)}
            glyphRadius={glyphRadius}
          >
            <rect
              x={flyScreenHandleRect.x}
              y={flyScreenHandleRect.y}
              width={flyScreenHandleRect.width}
              height={flyScreenHandleRect.height}
              rx={meshCell * 0.2}
              fill="var(--surface, var(--background))"
              stroke={MESH_STROKE}
              strokeWidth={meshCell * 0.12}
            />
            <text
              x={flyScreenHandleRect.x + flyScreenHandleRect.width / 2}
              y={flyScreenHandleRect.y + flyScreenHandleRect.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="ui-monospace, SF Mono, Menlo, Consolas, monospace"
              fontWeight="600"
              fontSize={meshCell * 0.95}
              fill="var(--muted-foreground)"
            >
              FS
            </text>
          </InteractivePart>
        )}

      </svg>

      {transform && (
        <>
          <DimensionInput
            style={{ left: transform.x(outerMm.width / 2), top: transform.y(topLineY) }}
            value={widthMm}
            onChange={onWidthChange}
            ariaLabel={widthLabel}
          />
          <DimensionInput
            style={{ left: transform.x(leftLineX), top: transform.y(outerMm.height / 2) }}
            value={heightMm}
            onChange={onHeightChange}
            ariaLabel={heightLabel}
          />
        </>
      )}
    </div>
  )
}

function issueStroke(issues: TranslatedIssue[] | undefined): string | null {
  const severity = worstSeverity(issues)
  if (severity === 'error') return ERROR_COLOR
  if (severity === 'warning') return WARNING_COLOR
  return null
}

/** Selected beats an issue beats the default thin gray outline. */
function partStroke(selected: boolean, issues: TranslatedIssue[] | undefined): string {
  if (selected) return 'var(--primary)'
  return issueStroke(issues) ?? DEFAULT_STROKE
}

/** The smallest rect containing all of `rects` — used to find a sash's
 * own opening (its ring's inner hole) from however many glass panes
 * currently share its index, whether that's the usual one or the two a
 * fixed-mullion split produces. */
function boundingRect(rects: WindowPart['rectMm'][]): WindowPart['rectMm'] {
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
function georgianBars(
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
function ringPath(outer: WindowPart['rectMm'], inner: WindowPart['rectMm']): string {
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
function openBottomFramePath(outer: WindowPart['rectMm'], inner: WindowPart['rectMm']): string {
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

function InteractivePart({
  part,
  selected,
  hovered,
  onSelect,
  onHover,
  children,
  ringRect,
  issues,
  glyphRadius,
  showOverlay = true,
}: {
  part: WindowPart
  selected: boolean
  hovered: boolean
  onSelect: (partId: string) => void
  onHover: (partId: string | null) => void
  children: React.ReactNode
  /** Override the highlight ring's rect — used by the fly-screen handle, whose hit target is small but whose ring should trace the whole mesh. */
  ringRect?: WindowPart['rectMm']
  issues?: TranslatedIssue[]
  glyphRadius?: number
  /** Frame/sash/glass skip this — their own fill+stroke already shows
   * selection, and since a sash's overlay rect spans the same area its
   * glass sits in (later, on top), the two tints would otherwise
   * alpha-blend into a muddy colour neither part actually has. */
  showOverlay?: boolean
}) {
  const rect = ringRect ?? part.rectMm
  const severity = worstSeverity(issues)
  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(part.id)
    }
  }
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(part.id)}
      onKeyDown={onKeyDown}
      onMouseEnter={() => onHover(part.id)}
      onMouseLeave={() => onHover(null)}
      className="cursor-pointer outline-none"
    >
      {children}
      {showOverlay && (selected || hovered) && (
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="var(--primary)"
          fillOpacity={selected ? 0.16 : 0.08}
          stroke={selected ? 'var(--primary)' : 'transparent'}
          strokeWidth={Math.max(rect.width, rect.height) * 0.006}
          pointerEvents="none"
        />
      )}
      {/* Transparent (not "none") so the whole rect keeps catching pointer events even where nothing is painted. */}
      <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="transparent" />
      {severity && issues && glyphRadius && (
        <g pointerEvents="none">
          <circle
            cx={rect.x + rect.width - glyphRadius}
            cy={rect.y + glyphRadius}
            r={glyphRadius}
            fill={severity === 'error' ? ERROR_COLOR : WARNING_COLOR}
          />
          <text
            x={rect.x + rect.width - glyphRadius}
            y={rect.y + glyphRadius}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={glyphRadius * 1.3}
            fontWeight="bold"
            fill="white"
          >
            !
          </text>
          <title>{issues.map((i) => i.message).join('\n')}</title>
        </g>
      )}
    </g>
  )
}

function DimensionInput({
  style,
  value,
  onChange,
  ariaLabel,
}: {
  style: { left: number; top: number }
  value: number
  onChange: (mm: number) => void
  ariaLabel: string
}) {
  return (
    <input
      type="number"
      min={1}
      dir="ltr"
      aria-label={ariaLabel}
      className="absolute w-16 -translate-x-1/2 -translate-y-1/2 rounded border border-border bg-background px-1 py-0.5 text-center text-xs tabular-nums text-foreground shadow-sm"
      style={{ left: style.left, top: style.top }}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => {
        const parsed = Number(e.target.value)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
    />
  )
}

function useSvgToClientTransform(
  svgRef: React.RefObject<SVGSVGElement | null>,
  viewBox: { minX: number; minY: number; width: number; height: number },
): { x: (userX: number) => number; y: (userY: number) => number } | null {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => setBox({ width: svg.clientWidth, height: svg.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [svgRef])

  if (!box || box.width === 0 || box.height === 0) return null

  const scale = Math.min(box.width / viewBox.width, box.height / viewBox.height)
  const offsetX = (box.width - viewBox.width * scale) / 2
  const offsetY = (box.height - viewBox.height * scale) / 2

  return {
    x: (userX: number) => offsetX + (userX - viewBox.minX) * scale,
    y: (userY: number) => offsetY + (userY - viewBox.minY) * scale,
  }
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

function renderOpeningTypeSymbols(sashes: WindowPart[], openingType: HingedOpeningType): React.ReactNode {
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
