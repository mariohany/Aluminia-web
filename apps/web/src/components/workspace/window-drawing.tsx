import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { SystemType } from '@repo/types/lookups'
import type { WindowBarInput } from '@repo/types/windows'
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
import { cn } from '@/lib/utils'
import {
  DEFAULT_FRAME_FILL,
  DEFAULT_GLASS_FILL,
  GLASS_FILL_OPACITY,
  MESH_STROKE,
  archOutlinePath,
  archRingPath,
  barPath,
  barPathsFor,
  boundingRect,
  georgianBars,
  isDoorHinged,
  mullionGridFor,
  openBottomFramePath,
  outlineOf,
  renderOpeningTypeSymbols,
  ringPath,
} from '@/components/workspace/window-shapes'
import {
  CROSSING_READOUT,
  dependentsOf,
  isNearBarCrossing,
  pointAlongBar,
  readoutFor,
  resolveAnchor,
  resolveBar,
  sagFromDragPoint,
  snapTarget,
  type BarAnchor,
  type Readout,
} from '@/lib/arch-bars'
import type { HeadOutline, PointMm } from '@/lib/arch-geometry'
import type { TranslatedIssue } from '@/lib/window-weight'

/** Fixed screen-pixel snap distance, converted to mm via the SVG's own
 * screen CTM scale at read time — zoom/DPI-invariant, per arch-bars.ts's
 * own doc comment on `snapTarget`'s `toleranceMm` calling for exactly
 * that rather than a baked-in mm figure that would snap tighter at a
 * higher zoom and looser at a lower one. */
const BAR_SNAP_TOLERANCE_PX = 14

/** Client (screen) coordinates → this SVG's own user-space (mm), via
 * the element's screen CTM rather than hand-inverting
 * `useSvgToClientTransform`'s forward transform — the browser already
 * knows this exactly, including the viewBox's `preserveAspectRatio`
 * centring, so there is no reason to re-derive it. `pxPerMm` (the CTM's
 * uniform scale factor) is what turns a fixed on-screen snap radius
 * into the right mm tolerance at whatever zoom the drawing is shown at. */
function svgPointFromClient(el: SVGGraphicsElement, clientX: number, clientY: number): { point: PointMm; pxPerMm: number } | null {
  const ctm = el.getScreenCTM()
  if (!ctm) return null
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { point: { x: p.x, y: p.y }, pxPerMm: ctm.a }
}

interface BarHover {
  point: PointMm
  snapped: BarAnchor | null
  readout: Readout
}

/** What's under the pointer while drawing a bar — the readout chip's
 * content (§6.1's four-row table) and whatever the click/shadow-line
 * would snap to. A bar × bar crossing refuses to snap (arch-bars.ts's
 * own `isNearBarCrossing`), checked first since `snapTarget` would
 * otherwise just pick one of the two ambiguously. */
function computeBarHover(e: MouseEvent<SVGGraphicsElement>, outline: HeadOutline, bars: WindowBarInput[]): BarHover | null {
  const resolved = svgPointFromClient(e.currentTarget, e.clientX, e.clientY)
  if (!resolved) return null
  const { point, pxPerMm } = resolved
  const toleranceMm = BAR_SNAP_TOLERANCE_PX / pxPerMm
  // snapTarget FIRST, `isNearBarCrossing` only to explain a `null`
  // result — never the other way around. `isNearBarCrossing` alone
  // can't tell "two bars actually cross here" apart from "two bars
  // just happen to already SHARE this exact endpoint" (tier 1 of
  // `snapTarget` doesn't care how many bars reference a point, only
  // that one exists within tolerance) — checking it first would refuse
  // a perfectly legitimate shared anchor the moment a second bar had
  // already been drawn from it. See arch-bars.ts's own doc comment on
  // `isNearBarCrossing`: it exists purely to explain a `null` from
  // `snapTarget`, not to gate the call to it (bug found live: a third
  // bar couldn't start from a point two existing bars already shared).
  const snapped = snapTarget(point, bars, outline, toleranceMm)
  if (snapped) return { point, snapped, readout: readoutFor(snapped, point, bars, outline) }
  if (isNearBarCrossing(point, bars, outline, toleranceMm)) return { point, snapped: null, readout: CROSSING_READOUT }
  return { point, snapped: null, readout: readoutFor(null, point, bars, outline) }
}

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
   * and which of its sides get one. `WindowEditor` decides both, via
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
  /** Already-translated messages, keyed by part id — window-editor-page.tsx builds this from `collectWindowIssues()` (apps/web/src/lib/window-weight.ts). */
  issuesByPart: Map<string, TranslatedIssue[]>

  // Bar drawing — arch_windows_planing.md §6.1/§6.2. Scoped to the
  // ACTIVE panel only: the toggle that turns this on lives beside that
  // panel's own Head section in window-part-panel.tsx, one level up.
  /** While true, the active panel's arched head/glass area is covered
   * by a capture layer that intercepts clicks for bar placement instead
   * of part selection — persistent across bars, per the user's own
   * chosen interaction (a toggle, not a one-shot tool). */
  barDrawMode: boolean
  /** `Escape` with no anchor pending exits draw mode — decided here,
   * since a pending anchor is this component's own local state and only
   * it knows whether one exists; a pending anchor gets cleared locally
   * instead. */
  onExitBarDrawMode: () => void
  /** Fires once a bar's second endpoint lands — always a fresh straight
   * (`sagMm: 0`) bar; bowing it is Step 11. */
  onAddBar: (bar: WindowBarInput) => void

  // Select / delete / drag — arch_windows_planing.md §6.3/§6.4. Also
  // scoped to the ACTIVE panel only, same posture as drawing above: a
  // bar belongs to one panel's own `bars` array, and only that panel's
  // options column shows its Bar section.
  selectedBarId: string | null
  onSelectBar: (barId: string) => void
  /** Set once a delete has been asked for (button or `Delete`/
   * `Backspace`) but not yet confirmed — drives the danger-colour
   * highlight on this bar and everything `dependentsOf` it, shown
   * BEFORE the confirm per §6.3, not just named in its text. */
  pendingDeleteBarId: string | null
  /** Delete/Backspace with a bar selected and draw mode off — starts
   * the confirm (sets `pendingDeleteBarId`), same as the Bar section's
   * own Delete button; the actual removal only happens once the user
   * confirms, owned by `WindowEditor`. */
  onRequestDeleteBar: () => void
  /** Fires on every mouse-move of an endpoint drag that resolves to a
   * valid anchor — re-written live, per §6.4, not just on release. */
  onUpdateBarAnchor: (barId: string, end: 'from' | 'to', anchor: BarAnchor) => void

  /** Bow — arch_windows_planing.md §6.5. Fires on every mouse-move of a
   * midpoint-handle drag, live like `onUpdateBarAnchor` above (not just
   * on release), so the radius readout in the Bar section updates
   * every frame per the plan's own "done when". */
  onUpdateBarSag: (barId: string, sagMm: number) => void
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
 * attachable are all owned by `WindowEditor`.
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
  barDrawMode,
  onExitBarDrawMode,
  onAddBar,
  selectedBarId,
  onSelectBar,
  pendingDeleteBarId,
  onRequestDeleteBar,
  onUpdateBarAnchor,
  onUpdateBarSag,
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

  // The active panel's own glass outline, iff it has an arched head —
  // bars only ever anchor onto ONE glass pane's outline (archable is
  // scoped to single-sash panels, same restriction Step 7's rendering
  // already relies on), so there's exactly one outline to draw against.
  const activeGlassPart = parts.find((p) => p.panelIndex === activePanelIndex && p.kind === 'glass')
  const activeGlassOutline = activeGlassPart ? outlineOf(activeGlassPart) : null
  const activePanelBars = panels[activePanelIndex]?.bars ?? []
  const activeFrameFill = panels[activePanelIndex]?.frameHex ?? DEFAULT_FRAME_FILL

  const [barPending, setBarPending] = useState<BarAnchor | null>(null)
  const [barHover, setBarHover] = useState<BarHover | null>(null)

  // Turning draw mode off (toggle re-click, switching the active panel,
  // flattening the head) abandons whatever was mid-placement — there is
  // no "resume" concept, so stale local state would only be confusing.
  useEffect(() => {
    if (!barDrawMode) {
      setBarPending(null)
      setBarHover(null)
    }
  }, [barDrawMode])
  useEffect(() => {
    setBarPending(null)
    setBarHover(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanelIndex])

  useEffect(() => {
    if (!barDrawMode) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (barPending) setBarPending(null)
      else onExitBarDrawMode()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [barDrawMode, barPending, onExitBarDrawMode])

  // Which bar's endpoint is being dragged, if any — §6.4. Local state,
  // same posture as barPending/barHover above: only the FINAL resolved
  // anchor gets bubbled up (on every valid move, not just on release —
  // §6.4 wants it re-written live so dependents visibly follow).
  const [barDrag, setBarDrag] = useState<{ barId: string; end: 'from' | 'to' } | null>(null)

  useEffect(() => {
    if (!barDrag || !activeGlassOutline) return
    const outline = activeGlassOutline
    const draggedIndex = activePanelBars.findIndex((b) => b.id === barDrag.barId)
    // Only bars at a STRICTLY LOWER index than the dragged one are
    // legal re-anchor targets — the same acyclicity rule
    // `barsAreOrdered`/§3 already enforce for a bar's OWN anchors.
    // Passing the full `activePanelBars` here (as the two-click draw in
    // Step 9 correctly does for a brand-new bar, always appended last)
    // would let this drag snap onto a LATER bar — including one that
    // already depends on the bar being dragged, which would be a real
    // cycle, not just a rule violation.
    const candidateBars = draggedIndex >= 0 ? activePanelBars.slice(0, draggedIndex) : []
    const onMove = (e: globalThis.MouseEvent) => {
      if (!svgRef.current) return
      const resolved = svgPointFromClient(svgRef.current, e.clientX, e.clientY)
      if (!resolved) return
      const { point, pxPerMm } = resolved
      const toleranceMm = BAR_SNAP_TOLERANCE_PX / pxPerMm
      // snapTarget alone — no `isNearBarCrossing` pre-check here either
      // (see `computeBarHover`'s own comment on the bug that ordering
      // caused): tier 1 already refuses nothing a shared endpoint
      // legitimately offers, and a genuine crossing simply falls out as
      // `snapTarget` itself returning `null` at tier 5.
      const snapped = snapTarget(point, candidateBars, outline, toleranceMm)
      // No anchor is ever "free space" (every endpoint is a reference,
      // never a bare coordinate) — over free space this just leaves the
      // endpoint at wherever it last validly resolved to, rather than
      // inventing a coordinate nothing in the model can represent.
      if (snapped) onUpdateBarAnchor(barDrag.barId, barDrag.end, snapped)
    }
    const onUp = () => setBarDrag(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barDrag, activeGlassOutline, activePanelBars, onUpdateBarAnchor])

  // Which bar's midpoint (bow) handle is being dragged, if any — §6.5.
  // Unlike `barDrag` above, this never re-anchors anything (a bow only
  // ever changes `sagMm`, never `from`/`to`), so there's no ordering
  // restriction to apply — every mouse-move just re-derives the sag
  // from the pointer's own perpendicular offset from the bar's chord.
  const [barSagDragId, setBarSagDragId] = useState<string | null>(null)

  useEffect(() => {
    if (!barSagDragId || !activeGlassOutline) return
    const bar = activePanelBars.find((b) => b.id === barSagDragId)
    const resolved = bar && resolveBar(bar, activePanelBars, activeGlassOutline)
    if (!bar || !resolved) return
    const onMove = (e: globalThis.MouseEvent) => {
      if (!svgRef.current) return
      const p = svgPointFromClient(svgRef.current, e.clientX, e.clientY)
      if (!p) return
      onUpdateBarSag(barSagDragId, sagFromDragPoint(resolved.from, resolved.to, p.point))
    }
    const onUp = () => setBarSagDragId(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barSagDragId, activeGlassOutline, activePanelBars, onUpdateBarSag])

  // Delete/Backspace with a bar selected — only when not mid-drawing
  // (a selected bar and draw mode are already mutually exclusive, see
  // window-editor-page.tsx) and only when focus isn't in a text field
  // elsewhere in the dialog (Notes, panel name, …), where Backspace
  // must keep editing text, not delete a bar the user isn't looking at.
  useEffect(() => {
    if (!selectedBarId || barDrawMode) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const active = document.activeElement
      const tag = active?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement | null)?.isContentEditable) return
      onRequestDeleteBar()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedBarId, barDrawMode, onRequestDeleteBar])

  // Everything that would go with a delete of `pendingDeleteBarId` —
  // itself plus its full transitive closure — highlighted in the
  // danger colour BEFORE the confirm even renders, per §6.3.
  const highlightedBarIds = pendingDeleteBarId ? dependentsOf(pendingDeleteBarId, activePanelBars) : new Set<string>()
  if (pendingDeleteBarId) highlightedBarIds.add(pendingDeleteBarId)

  // Resolved once here (not inside the SVG markup below) since both the
  // SVG-space shadow line/markers AND the HTML-space midpoint length
  // label need the same two points.
  const barPendingPoint =
    barPending && activeGlassOutline ? resolveAnchor(barPending, activePanelBars, activeGlassOutline) : null
  const barSnappedPoint =
    barHover?.snapped && activeGlassOutline ? resolveAnchor(barHover.snapped, activePanelBars, activeGlassOutline) : null
  // The shadow line's free end follows the raw pointer once a first
  // anchor is down, even over free space — snapped when there's
  // something to snap to (so "what you see is what you get" per §6.2),
  // otherwise the bare pointer position; never drawn at all over a
  // crossing, which has no real point worth a line pointing at it.
  const barShadowTo = barPending ? (barSnappedPoint ?? (barHover && !barHover.readout.warn ? barHover.point : null)) : null
  const barShadowMidpoint = barPendingPoint && barShadowTo ? pointAlongBar(barPendingPoint, barShadowTo, 0, 0.5) : null
  const barShadowLengthMm =
    barPendingPoint && barShadowTo ? Math.round(Math.hypot(barShadowTo.x - barPendingPoint.x, barShadowTo.y - barPendingPoint.y)) : null

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

        {/* The bar-drawing capture layer — an exact arch-shaped hit
            area (not a bounding rect) covering only the active panel's
            own glass, painted last among the panel shapes so it
            intercepts clicks/hover meant for it before they reach the
            selection handlers underneath. Persistent per the user's own
            chosen interaction: it stays mounted across multiple bars,
            only unmounting when `barDrawMode` goes false. */}
        {barDrawMode && activeGlassOutline && (
          <g>
            <path
              d={archOutlinePath(activeGlassOutline)}
              fill="transparent"
              className="cursor-crosshair"
              onMouseMove={(e) => setBarHover(computeBarHover(e, activeGlassOutline, activePanelBars))}
              onMouseLeave={() => setBarHover(null)}
              onClick={(e) => {
                const r = computeBarHover(e, activeGlassOutline, activePanelBars)
                if (!r || !r.snapped) return
                if (!barPending) {
                  setBarPending(r.snapped)
                  return
                }
                // A second click resolving to the exact same point as
                // the first (e.g. a double-click) would otherwise
                // append a zero-length bar — ignore it and keep waiting
                // for a genuinely different second anchor.
                const toPoint = resolveAnchor(r.snapped, activePanelBars, activeGlassOutline)
                if (barPendingPoint && toPoint && Math.hypot(toPoint.x - barPendingPoint.x, toPoint.y - barPendingPoint.y) < 0.01) {
                  return
                }
                onAddBar({ id: crypto.randomUUID(), from: barPending, to: r.snapped, sagMm: 0 })
                setBarPending(null)
              }}
            />
            {/* The dashed shadow line, §6.2 — from the stored first
                anchor to wherever the live pointer would resolve to,
                using the exact same barPath sampling the committed bar
                layer draws with, so nothing about the curve's own shape
                changes the instant it's actually placed. */}
            {barPendingPoint && barShadowTo && (
              <path
                d={barPath(barPendingPoint, barShadowTo, 0)}
                fill="none"
                stroke={activeFrameFill}
                strokeWidth={georgianBarWidth}
                strokeDasharray={`${georgianBarWidth * 1.5} ${georgianBarWidth * 1.2}`}
                opacity={0.75}
                pointerEvents="none"
              />
            )}
            {barPendingPoint && (
              <circle cx={barPendingPoint.x} cy={barPendingPoint.y} r={strokeWeight * 2.2} fill="var(--primary)" pointerEvents="none" />
            )}
            {barSnappedPoint && (
              <circle
                cx={barSnappedPoint.x}
                cy={barSnappedPoint.y}
                r={strokeWeight * 1.8}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={strokeWeight}
                pointerEvents="none"
              />
            )}
          </g>
        )}

        {/* Bar select/delete-highlight/drag — §6.3/§6.4. Off while
            drawing (barDrawMode's own capture layer already owns every
            click over this area then). Painted as an ADD-ON over the
            plain bar layer PanelShapes already drew (Step 9) rather
            than threading selection state through that read-only paint
            component — a wide invisible hit-stroke for click-to-select
            (the visible bar itself is too thin to click precisely),
            plus a coloured restroke for whichever bars are selected or
            about to be cascade-deleted. */}
        {!barDrawMode && activeGlassOutline && activePanelBars.length > 0 && (
          <g>
            {barPathsFor(activePanelBars, activeGlassOutline).map((bar) => {
              const isSelected = bar.id === selectedBarId
              const isHighlighted = highlightedBarIds.has(bar.id)
              return (
                <g key={bar.id}>
                  <path
                    d={bar.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={georgianBarWidth * 2.5}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectBar(bar.id)
                    }}
                  />
                  {(isSelected || isHighlighted) && (
                    <path
                      d={bar.d}
                      fill="none"
                      stroke={isHighlighted ? ERROR_COLOR : 'var(--primary)'}
                      strokeWidth={georgianBarWidth * 1.4}
                      pointerEvents="none"
                    />
                  )}
                </g>
              )
            })}
            {/* Endpoint drag handles — only for the selected bar, same
                "select first, then its handles appear" posture most
                vector editors use, rather than cluttering every bar
                with handles all the time. Plus the bow (midpoint)
                handle, §6.5 — a distinct FILLED marker so it doesn't
                read as a third, identical endpoint. */}
            {selectedBarId &&
              (() => {
                const bar = activePanelBars.find((b) => b.id === selectedBarId)
                const resolved = bar && resolveBar(bar, activePanelBars, activeGlassOutline)
                if (!bar || !resolved) return null
                const peak = pointAlongBar(resolved.from, resolved.to, bar.sagMm, 0.5)
                return (
                  <>
                    {(['from', 'to'] as const).map((end) => {
                      const p = resolved[end]
                      return (
                        <circle
                          key={end}
                          cx={p.x}
                          cy={p.y}
                          r={strokeWeight * 2.4}
                          fill="var(--background)"
                          stroke="var(--primary)"
                          strokeWidth={strokeWeight}
                          className="cursor-move"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            setBarDrag({ barId: bar.id, end })
                          }}
                        />
                      )
                    })}
                    <circle
                      cx={peak.x}
                      cy={peak.y}
                      r={strokeWeight * 2}
                      fill="var(--primary)"
                      stroke="var(--background)"
                      strokeWidth={strokeWeight * 0.6}
                      className="cursor-move"
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        setBarSagDragId(bar.id)
                      }}
                    />
                  </>
                )
              })()}
          </g>
        )}

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

      {/* The hover readout chip — arch_windows_planing.md §6.1's
          four-row table. HTML, not SVG text, so its size stays legible
          regardless of the drawing's own zoom, same reasoning as
          DimensionInput above. Flips to the cursor's other side near
          the drawing's right edge so it can never run out past the
          viewBox — "near the edge" reuses the same margin the viewBox
          itself pads by. */}
      {transform && barDrawMode && barHover && (
        <div
          className={cn(
            'pointer-events-none absolute -translate-y-[130%] rounded-md border border-border bg-background/95 px-2 py-1 text-[11px] leading-tight whitespace-nowrap shadow-sm tabular-nums',
            barHover.point.x > outerMm.width - margin * 1.5 ? '-translate-x-full' : '',
          )}
          style={{ left: transform.x(barHover.point.x), top: transform.y(barHover.point.y) }}
        >
          <div className={barHover.readout.warn ? 'font-medium text-amber-600 dark:text-amber-500' : 'text-foreground'}>
            {barHover.readout.line1}
          </div>
          <div className="text-muted-foreground">{barHover.readout.line2}</div>
        </div>
      )}

      {/* The shadow line's own length, at its midpoint — §6.2. */}
      {transform && barShadowMidpoint && barShadowLengthMm !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-background/95 px-1 py-0.5 text-[10px] font-medium tabular-nums shadow-sm"
          style={{ left: transform.x(barShadowMidpoint.x), top: transform.y(barShadowMidpoint.y) }}
        >
          {barShadowLengthMm} mm
        </div>
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
  //
  // A transom's frame has NO sash at all (docs/transom_planing.md
  // decision 1) — `buildTransomLayout` insets its own glass by
  // `NOMINAL_TRANSOM_FACE_MM`, a DIFFERENT constant than the
  // `NOMINAL_FRAME_FACE_MM` this inset math assumes. Found while
  // verifying Step 4 (transom_tasks.md): re-deriving the opening from
  // the sash-inset constant when there IS no sash would cut the ring's
  // hole at the wrong width, so the ring and the glass (drawn
  // separately below, straight off its own real rect) visibly
  // disagree — the glass fill spills into what should still read as
  // frame face. Deriving the opening from the glass parts' own union
  // instead, whenever there's no sash to derive it from, means the
  // ring's hole can never disagree with the glass actually drawn,
  // regardless of what inset constant built it.
  const frameOpening =
    frame &&
    (sashes.length > 0
      ? {
          x: frame.rectMm.x + NOMINAL_FRAME_FACE_MM,
          y: frame.rectMm.y + NOMINAL_FRAME_FACE_MM,
          width: frame.rectMm.width - 2 * NOMINAL_FRAME_FACE_MM,
          height: frame.rectMm.height - NOMINAL_FRAME_FACE_MM - (doorHinged ? 0 : NOMINAL_FRAME_FACE_MM),
        }
      : glasses.length > 0
        ? boundingRect(glasses.map((g) => g.rectMm))
        : null)

  const frameFill = panel.frameHex ?? DEFAULT_FRAME_FILL

  // Arch-aware frame ring. `frame.head`/a single sash's `head` are only
  // ever set together (see buildWindowLayout's `archable`), so reading
  // the opening straight off that one sash — rather than hand-deriving
  // it a second way, as `frameOpening` above still does for every other
  // case — can't disagree with what was actually built.
  const frameOutline = frame && outlineOf(frame)
  const singleSashOutline = sashes.length === 1 ? outlineOf(sashes[0]) : null
  const framePathD =
    frame &&
    (frameOutline && singleSashOutline
      ? archRingPath(frameOutline, singleSashOutline)
      : frameOpening &&
        (doorHinged ? openBottomFramePath(frame.rectMm, frameOpening) : ringPath(frame.rectMm, frameOpening)))

  return (
    <g data-panel={panelIndex} onMouseEnter={() => onPanelHover(panelIndex)}>
      {frame && framePathD && (
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
            d={framePathD}
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
      {flyScreen && (() => {
        const flyScreenOutline = outlineOf(flyScreen)
        return flyScreenOutline ? (
          <path
            d={archOutlinePath(flyScreenOutline)}
            fill={`url(#${meshPatternId})`}
            stroke={MESH_STROKE}
            strokeWidth={NOMINAL_SASH_FACE_MM * 0.25}
            opacity={0.85}
            pointerEvents="none"
          />
        ) : (
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
        )
      })()}

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
        const sashOutline = outlineOf(sash)
        const glassOutline = glassesForSash.length === 1 ? outlineOf(glassesForSash[0]) : null
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
              d={sashOutline && glassOutline ? archRingPath(sashOutline, glassOutline) : ringPath(sash.rectMm, opening)}
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

      {glasses.map((glass) => {
        const glassOutline = outlineOf(glass)
        return (
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
            {glassOutline ? (
              <path
                d={archOutlinePath(glassOutline)}
                fill={panel.glassHex ?? DEFAULT_GLASS_FILL}
                fillOpacity={GLASS_FILL_OPACITY}
                stroke={partStroke(selectedPartId === glass.id, issuesByPart.get(glass.id))}
                strokeWidth={strokeWeight}
              />
            ) : (
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
            )}
            {panel.georgianGrid && (
              <g pointerEvents="none">{georgianBars(glass.rectMm, panel.georgianGrid, georgianBarWidth, frameFill)}</g>
            )}
            {/* The bar layer itself — pure visual here; the
                interactive select/highlight/drag overlay for the
                ACTIVE panel's own bars is a separate layer painted
                later in `WindowDrawing` (see its own comment), on top
                of every panel's plain paint below. Drawn above the
                glass fill, below the opening-type symbol below, same
                stacking the plan calls for. Same width as a Georgian
                bar (`georgianBarWidth`), not the hairline `strokeWeight`
                every outline uses — a glazing bar is a real decorative
                bar, not a thin selection outline. */}
            {glassOutline && panel.bars.length > 0 && (
              <g pointerEvents="none">
                {barPathsFor(panel.bars, glassOutline).map((bar) => (
                  <path key={bar.id} d={bar.d} fill="none" stroke={frameFill} strokeWidth={georgianBarWidth} />
                ))}
              </g>
            )}
          </InteractivePart>
        )
      })}

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
      className="group cursor-pointer outline-none"
      onClick={(e: MouseEvent<SVGGElement>) => {
        e.stopPropagation()
        onAdd()
      }}
      onKeyDown={onKeyDown}
    >
      {/* Generous invisible hit area — the visible dot is small, but a
          small SVG target at an arbitrary zoom is fiddly to hit. Full
          opacity always, so it isn't fighting the dimmed marker below
          for clicks. */}
      <circle cx={centre.x} cy={centre.y} r={radius * 1.9} fill="transparent" />
      {/* Dimmed by default — a resting "+" on every free edge reads as
          a lot of visual noise; full opacity on hover/focus is what
          confirms which one is about to fire before the click does. */}
      <g className="opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <circle cx={centre.x} cy={centre.y} r={radius} fill="var(--primary)" />
        <path
          d={`M${centre.x - arm} ${centre.y} H${centre.x + arm} M${centre.x} ${centre.y - arm} V${centre.y + arm}`}
          stroke="var(--primary-foreground)"
          strokeWidth={radius * 0.22}
          strokeLinecap="round"
        />
      </g>
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
