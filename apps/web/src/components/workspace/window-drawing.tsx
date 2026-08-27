import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { SystemType } from '@repo/types/lookups'
import {
  NOMINAL_FRAME_FACE_MM,
  NOMINAL_MULLION_BAR_MM,
  NOMINAL_SASH_FACE_MM,
  type AssemblyLayout,
  type PanelSide,
  type RectMm,
  type WindowPart,
} from '@/lib/window-geometry'
import type { PanelRender } from '@/lib/window-render'
import {
  DEFAULT_FRAME_FILL,
  DEFAULT_GLASS_FILL,
  GLASS_FILL_OPACITY,
  MESH_STROKE,
  boundingRect,
  georgianBars,
  isDoorHinged,
  mullionGridFor,
  openBottomFramePath,
  renderOpeningTypeSymbols,
  ringPath,
} from '@/components/workspace/window-shapes'
import type { TranslatedIssue } from '@/lib/window-weight'

const ERROR_COLOR = 'var(--destructive)'
const WARNING_COLOR = 'oklch(0.72 0.15 75)'
/** Default outline on every shape (frame/sash/glass) — replaced by the
 * selected/issue colour when either applies. */
const DEFAULT_STROKE = 'var(--border)'

export interface WindowDrawingProps {
  layout: AssemblyLayout
  panels: PanelRender[]
  selectedPartId: string | null
  hoveredPartId: string | null
  /** `additive` is a ctrl/cmd-click — it toggles the part's panel into
   * the panel selection without changing which part is selected. */
  onSelect: (partId: string, additive: boolean) => void
  onHover: (partId: string | null) => void
  /** Panels currently in the selection set, for the "+" affordance. */
  selectedPanelIndices: number[]
  /** Whose dimension inputs are shown and editable. */
  activePanelIndex: number
  onPanelWidthChange: (mm: number) => void
  onPanelHeightChange: (mm: number) => void
  /** aria-labels for the two dimension inputs — translated by the caller (`t('fields.widthMm')`/`t('fields.heightMm')`), since this component takes no i18n dependency of its own. */
  widthLabel: string
  heightLabel: string
  /** Where the "+" markers sit (the current selection's bounding box)
   * and which of its sides get one. `WindowDialog` decides both, via
   * `freeSidesOf()` — the drawing renders whatever it's handed and makes
   * no judgement about what's attachable. An empty `attachSides` draws
   * nothing. */
  attachRect: RectMm | null
  attachSides: PanelSide[]
  /** Which panel the pointer is over, `null` once it leaves the drawing
   * entirely. Deliberately NOT derived from `hoveredPartId`: that
   * clears the instant the pointer crosses from a panel onto one of the
   * "+" markers, which would pull the button out from under the cursor.
   * This only clears at the edge of the whole drawing, so travelling
   * from a panel to its own marker keeps them on screen. */
  onPanelHover: (panelIndex: number | null) => void
  /** `at` is the marker's own position in CLIENT pixels — the caller
   * anchors the size popup there. Computed here because this component
   * already owns the SVG→client transform; recomputing it outside would
   * mean a second copy of the same viewBox maths. */
  onAddPanel: (side: PanelSide, at: { left: number; top: number }) => void
  /** Rendered into the drawing's own `relative` overlay box, on top of
   * the SVG — the same layer the dimension inputs use. The add-panel
   * card lives here rather than in a portal so it shares this dialog's
   * focus scope; see add-panel-card.tsx for what went wrong otherwise. */
  overlay?: React.ReactNode
  /** Already-translated messages, keyed by part id — window-dialog.tsx builds this from `collectWindowIssues()` (apps/web/src/lib/window-weight.ts). */
  issuesByPart: Map<string, TranslatedIssue[]>
}

function worstSeverity(issues: TranslatedIssue[] | undefined): TranslatedIssue['severity'] | null {
  if (!issues || issues.length === 0) return null
  return issues.some((i) => i.severity === 'error') ? 'error' : 'warning'
}

/**
 * Pure presentational elevation of a whole ASSEMBLY. All geometry comes
 * from `buildAssemblyLayout()` (apps/web/src/lib/window-geometry.ts) —
 * nothing here is computed beyond pixel-space derived from it.
 * Selection/hover state, the panel model, and which sides are
 * attachable are all owned by `WindowDialog`.
 */
export function WindowDrawing({
  layout,
  panels,
  selectedPartId,
  hoveredPartId,
  onSelect,
  onHover,
  selectedPanelIndices,
  activePanelIndex,
  onPanelWidthChange,
  onPanelHeightChange,
  widthLabel,
  heightLabel,
  attachRect,
  attachSides,
  onPanelHover,
  onAddPanel,
  overlay,
  issuesByPart,
}: WindowDrawingProps) {
  const { outerMm, parts, panelRects } = layout
  // The margin has to clear the "+" markers as well as the dimension
  // lines now — a marker on the outer edge of the assembly sits a little
  // outside it.
  const margin = Math.max(outerMm.width, outerMm.height) * 0.16
  const viewBox = { minX: -margin, minY: -margin, width: outerMm.width + margin * 2, height: outerMm.height + margin * 2 }
  const meshCell = Math.max(outerMm.width, outerMm.height) * 0.02
  const tickLen = margin * 0.18
  const glyphRadius = Math.max(outerMm.width, outerMm.height) * 0.018
  // The thin outline every shape (frame/sash/glass) gets around its own
  // edges — gray by default, orange (primary) once selected.
  const strokeWeight = Math.max(outerMm.width, outerMm.height) * 0.0028
  // A Georgian bar reads as a slim version of the frame/sash face, not a
  // hairline — same material colour, just thinner.
  const georgianBarWidth = Math.max(outerMm.width, outerMm.height) * 0.012
  // Sized off the whole assembly so every marker is the same size
  // regardless of which panel it belongs to.
  const plusRadius = Math.max(outerMm.width, outerMm.height) * 0.026

  const meshPatternId = 'window-drawing-mesh'

  const svgRef = useRef<SVGSVGElement>(null)
  const transform = useSvgToClientTransform(svgRef, viewBox)

  const topLineY = -margin * 0.5
  const leftLineX = -margin * 0.5

  const activeRect = panelRects[activePanelIndex] ?? panelRects[0]

  return (
    // A technical elevation has real left/right meaning (hinge side,
    // which sash overlaps which) — it must not mirror in RTL, unlike
    // the rest of the dialog. See docs/window_design_planing.md's
    // rejected-alternatives note.
    <div dir="ltr" className="relative h-full w-full" onMouseLeave={() => onPanelHover(null)}>
      <svg
        ref={svgRef}
        viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
        // Bottom-anchored, not the default xMidYMid: adding a panel grows
        // outerMm (most visibly its height, from a top/bottom "+"), and a
        // centred viewBox would re-centre the whole elevation in its box
        // every time, making already-placed panels appear to jump. Pinning
        // the bottom means growth reads as the drawing extending upward
        // from a fixed baseline instead. `useSvgToClientTransform` below
        // mirrors this offset for the HTML overlay (dimension inputs, "+"
        // markers, the add-panel card) so they stay aligned to the shapes.
        preserveAspectRatio="xMidYMax meet"
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

        {/* Overall assembly dimensions — READ-ONLY now. They're derived
            from the panels' bounding box (the API refuses to accept them
            as input at all), so there is nothing here to type into; the
            editable inputs belong to the selected panel instead. */}
        <g stroke="var(--muted-foreground)" strokeWidth={Math.max(outerMm.width, outerMm.height) * 0.0018} opacity={0.6}>
          <line x1={0} y1={topLineY} x2={outerMm.width} y2={topLineY} />
          <line x1={0} y1={topLineY - tickLen / 2} x2={0} y2={topLineY + tickLen / 2} />
          <line x1={outerMm.width} y1={topLineY - tickLen / 2} x2={outerMm.width} y2={topLineY + tickLen / 2} />
          <line x1={leftLineX} y1={0} x2={leftLineX} y2={outerMm.height} />
          <line x1={leftLineX - tickLen / 2} y1={0} x2={leftLineX + tickLen / 2} y2={0} />
          <line x1={leftLineX - tickLen / 2} y1={outerMm.height} x2={leftLineX + tickLen / 2} y2={outerMm.height} />
        </g>

        {panels.map((panel, panelIndex) => (
          <PanelShapes
            key={panelIndex}
            panelIndex={panelIndex}
            panel={panel}
            parts={parts.filter((p) => p.panelIndex === panelIndex)}
            selectedPartId={selectedPartId}
            hoveredPartId={hoveredPartId}
            onSelect={onSelect}
            onHover={onHover}
            issuesByPart={issuesByPart}
            onPanelHover={onPanelHover}
            meshPatternId={meshPatternId}
            meshCell={meshCell}
            glyphRadius={glyphRadius}
            strokeWeight={strokeWeight}
            georgianBarWidth={georgianBarWidth}
          />
        ))}

        {/* Panel selection outline — drawn over everything so a selected
            panel reads as a unit even when the part inside it that's
            actually selected is a single glass light. Purely an
            indicator: pointer-events off, so it never swallows a click
            meant for the shapes underneath. */}
        {selectedPanelIndices.map((index) => {
          const rect = panelRects[index]
          if (!rect) return null
          return (
            <rect
              key={`panel-selection-${index}`}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={strokeWeight * 2.5}
              strokeDasharray={`${plusRadius * 0.5} ${plusRadius * 0.35}`}
              pointerEvents="none"
            />
          )
        })}

        {attachRect &&
          attachSides.map((side) => {
            const centre = markerCentre(side, attachRect, plusRadius)
            return (
              <AddPanelMarker
                key={side}
                centre={centre}
                side={side}
                radius={plusRadius}
                onAdd={() =>
                  onAddPanel(
                    side,
                    transform
                      ? { left: transform.x(centre.x), top: transform.y(centre.y) }
                      : { left: 0, top: 0 },
                  )
                }
              />
            )
          })}
      </svg>

      {transform && activeRect && (
        <>
          {/* Bound to the SELECTED PANEL, not the assembly — for a
              one-panel window that's the same thing it always was.
              Placed just INSIDE the panel rather than on its edge:
              between two coupled panels an edge-straddling input would
              sit on the joint and read as belonging to either one. */}
          <DimensionInput
            style={{
              left: transform.x(activeRect.x + activeRect.width / 2),
              top: transform.y(activeRect.y + dimensionInset(activeRect)),
            }}
            value={Math.round(activeRect.width)}
            onChange={onPanelWidthChange}
            ariaLabel={widthLabel}
          />
          <DimensionInput
            style={{
              left: transform.x(activeRect.x + dimensionInset(activeRect)),
              top: transform.y(activeRect.y + activeRect.height / 2),
            }}
            value={Math.round(activeRect.height)}
            onChange={onPanelHeightChange}
            ariaLabel={heightLabel}
          />
        </>
      )}

      {overlay}
    </div>
  )
}

/**
 * One panel's frame ring, fly-screen mesh, sash rings, glass panes and
 * hinge symbol — everything `buildWindowLayout()` produced for it,
 * already offset into assembly space by `buildAssemblyLayout()`.
 */
function PanelShapes({
  panelIndex,
  panel,
  parts,
  selectedPartId,
  hoveredPartId,
  onSelect,
  onHover,
  issuesByPart,
  onPanelHover,
  meshPatternId,
  meshCell,
  glyphRadius,
  strokeWeight,
  georgianBarWidth,
}: {
  panelIndex: number
  panel: PanelRender
  parts: WindowPart[]
  selectedPartId: string | null
  hoveredPartId: string | null
  onSelect: (partId: string, additive: boolean) => void
  onHover: (partId: string | null) => void
  issuesByPart: Map<string, TranslatedIssue[]>
  onPanelHover: (panelIndex: number | null) => void
  meshPatternId: string
  meshCell: number
  glyphRadius: number
  strokeWeight: number
  georgianBarWidth: number
}) {
  // A fixed-mullion bar, unlike a Georgian one, has a real mm width
  // already baked into the geometry (it's the actual gap
  // window-geometry.ts split the two lights by) — draw it at that exact
  // width rather than a proportional guess, or it won't line up with
  // the gap between the two glass rects.
  const mullionGrid = mullionGridFor(panel.openingType)

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
  const doorHinged = isDoorHinged(panel.isDoor, panel.systemType)

  // The panel's own opening — the union of all sashes always exactly
  // fills this rect (see buildSlidingSashRects's own interlock math),
  // so it doubles as the frame ring's inner boundary regardless of
  // systemType, without needing a dedicated WindowPart for it. A hinged
  // door drops the bottom inset so it lines up with the now
  // flush-to-the-bottom sash/glass.
  const frameOpening = frame && {
    x: frame.rectMm.x + NOMINAL_FRAME_FACE_MM,
    y: frame.rectMm.y + NOMINAL_FRAME_FACE_MM,
    width: frame.rectMm.width - 2 * NOMINAL_FRAME_FACE_MM,
    height: frame.rectMm.height - NOMINAL_FRAME_FACE_MM - (doorHinged ? 0 : NOMINAL_FRAME_FACE_MM),
  }

  const frameFill = panel.frameHex ?? DEFAULT_FRAME_FILL

  return (
    <g data-panel={panelIndex} onMouseEnter={() => onPanelHover(panelIndex)}>
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
            d={doorHinged ? openBottomFramePath(frame.rectMm, frameOpening) : ringPath(frame.rectMm, frameOpening)}
            fillRule="evenodd"
            fill={frameFill}
            stroke={partStroke(selectedPartId === frame.id, issuesByPart.get(frame.id))}
            strokeWidth={strokeWeight}
          />
        </InteractivePart>
      )}

      {/* The fly-screen mesh is visual only (pointer-events none) — for
          a hinged/curtain-wall panel it fully overlaps the sash/glass
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
              <g pointerEvents="none">{georgianBars(opening, mullionGrid, NOMINAL_MULLION_BAR_MM, frameFill)}</g>
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
            fill={panel.glassHex ?? DEFAULT_GLASS_FILL}
            fillOpacity={GLASS_FILL_OPACITY}
            stroke={partStroke(selectedPartId === glass.id, issuesByPart.get(glass.id))}
            strokeWidth={strokeWeight}
          />
          {panel.georgianGrid && (
            <g pointerEvents="none">{georgianBars(glass.rectMm, panel.georgianGrid, georgianBarWidth, frameFill)}</g>
          )}
        </InteractivePart>
      ))}

      {panel.hasFrame && panel.systemType === SystemType.HINGED && panel.openingType && (
        <g pointerEvents="none">{renderOpeningTypeSymbols(sashes, panel.openingType)}</g>
      )}

      {/* The fly screen's own hit target — a small pull-handle glyph
          at the bottom edge of its rect, always on top so it stays
          reachable. Its hit box (ringRect) is deliberately just the
          handle itself, not the full mesh rect — the mesh fully
          overlaps the sash/glass beneath it for a hinged/curtain-wall
          panel, and a full-rect hit box there would swallow every
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
    </g>
  )
}

/**
 * The "+" on a free side of the current selection. Sits just outside the
 * edge it would attach to, so it never covers the panel it belongs to.
 *
 * `onHoverChange` is what keeps it reachable: the panel's own
 * mouseleave fires the moment the pointer crosses onto this button, and
 * without telling the dialog "still hovering", the markers would vanish
 * out from under the cursor.
 */
/** Where a side's "+" sits — just outside the edge it would attach to,
 * so it never covers the panel it belongs to. */
function markerCentre(side: PanelSide, rect: RectMm, radius: number): { x: number; y: number } {
  return {
    top: { x: rect.x + rect.width / 2, y: rect.y - radius * 1.2 },
    bottom: { x: rect.x + rect.width / 2, y: rect.y + rect.height + radius * 1.2 },
    left: { x: rect.x - radius * 1.2, y: rect.y + rect.height / 2 },
    right: { x: rect.x + rect.width + radius * 1.2, y: rect.y + rect.height / 2 },
  }[side]
}

function AddPanelMarker({
  side,
  centre,
  radius,
  onAdd,
}: {
  side: PanelSide
  centre: { x: number; y: number }
  radius: number
  onAdd: () => void
}) {
  const arm = radius * 0.5
  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onAdd()
    }
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`add-panel-${side}`}
      className="cursor-pointer outline-none"
      onClick={(e: MouseEvent<SVGGElement>) => {
        e.stopPropagation()
        onAdd()
      }}
      onKeyDown={onKeyDown}
    >
      {/* Generous invisible hit area — the visible dot is small, but a
          small SVG target at an arbitrary zoom is fiddly to hit. */}
      <circle cx={centre.x} cy={centre.y} r={radius * 1.9} fill="transparent" />
      <circle cx={centre.x} cy={centre.y} r={radius} fill="var(--primary)" />
      <path
        d={`M${centre.x - arm} ${centre.y} H${centre.x + arm} M${centre.x} ${centre.y - arm} V${centre.y + arm}`}
        stroke="var(--primary-foreground)"
        strokeWidth={radius * 0.22}
        strokeLinecap="round"
      />
    </g>
  )
}

/** How far inside a panel its own dimension inputs sit — proportional,
 * so a small panel in a big assembly still keeps them within itself. */
function dimensionInset(rect: RectMm): number {
  return Math.min(rect.width, rect.height) * 0.16
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
  onSelect: (partId: string, additive: boolean) => void
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
      // Shift+Enter is the keyboard equivalent of ctrl/cmd-click — it
      // toggles this part's panel into the selection without moving
      // which part is selected.
      onSelect(part.id, e.shiftKey)
    }
  }
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={(e: MouseEvent<SVGGElement>) => onSelect(part.id, e.ctrlKey || e.metaKey)}
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
  // Matches the SVG's own `preserveAspectRatio="xMidYMax meet"`: bottom-
  // aligned, not centred — see the comment on the `<svg>` element above.
  const offsetY = box.height - viewBox.height * scale

  return {
    x: (userX: number) => offsetX + (userX - viewBox.minX) * scale,
    y: (userY: number) => offsetY + (userY - viewBox.minY) * scale,
  }
}
