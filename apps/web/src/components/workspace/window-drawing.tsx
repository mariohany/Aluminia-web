import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { SystemType } from '@repo/types/lookups'
import type { WindowBarInput } from '@repo/types/windows'
import { Button } from '@/components/ui/button'
import {
  alignedEdgeMm,
  cumulativeBoundaries,
  formatDimensionMm,
  freeSidesOf,
  matchedPanelSize,
  parsePartId,
  positionFromPanelSize,
  prospectivePanelSize,
  sectionLetter,
  type AssemblyLayout,
  type PanelSide,
  type RectMm,
  type WindowPart,
} from '@/lib/window-geometry'
import { sectionRenderFor, type PanelRender } from '@/lib/window-render'
import { cn } from '@/lib/utils'
import {
  DEFAULT_FRAME_FILL,
  DEFAULT_GLASS_FILL,
  GLASS_FILL_OPACITY,
  MESH_STROKE,
  MESH_STROKE_WIDTH_MM,
  renderDivider,
  renderFrameDetail,
  renderGasket,
  renderSashDetail,
  seamColorFor,
  type DetailStyle,
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
  renderHardware,
  renderFixedSymbols,
  renderOpeningTypeSymbols,
  renderSlidingHardware,
  renderSlidingSymbols,
  ringPath,
  slidingHiddenEdges,
  slidingPaintOrder,
  slidingStrokeScale,
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

/** Real magnet radius (unlike the exact-mm-only edge-position guide,
 * per Mario's own back-and-forth on that one) for the SIZE-match snap —
 * "try snaping to match hight or width again." Same zoom-invariant
 * pixel-radius pattern as `BAR_SNAP_TOLERANCE_PX`. */
const SIZE_MATCH_SNAP_TOLERANCE_PX = 14

// The drawing's own camera — see the `camera`/`baseViewBox` state in
// `WindowDrawing` for why this is decoupled from content size entirely.
const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 1.2
function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

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
  /** Which panel's bars/glass-outline/frame-fill below are "active" —
   * its size is edited from the side panel now (`window-part-panel.tsx`'s
   * own width/height fields), not from an overlay here (Mario,
   * 2026-09-13: "show sizes outside the drawing and remove the fields
   * on the drawing" — the side panel already had an identical pair of
   * fields wired to the same `onPanelSizeChange`, so the drawing's own
   * copy was a genuine duplicate, not a second real control). */
  activePanelIndex: number
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

  /** Dragging a mullion/transom — Mario, 2026-09-15: "move the transom/
   * mullion in the panel by dragging it." Fires on every mouse-move of a
   * divider drag with the divider's own full assembly part id (e.g.
   * `"p0:div-v1"`) and the pointer's desired boundary position, in
   * PANEL-LOCAL mm along the divider's axis (same coordinate space
   * `cumulativeBoundaries` uses) — `WindowEditor` parses the id and
   * calls `moveDivider()`, same division of labour as `onSelect`/
   * `onUpdateBarAnchor` above (this component only ever resolves screen
   * pixels to SVG mm; it never touches the panel model itself). */
  onDividerDrag: (dividerPartId: string, boundaryMm: number) => void

  /** Dragging a panel's own FREE outer edge in/out — Mario: "resize the
   * window by dragging any side in or out." Fires on every mouse-move
   * with the panel index, which side, and the pointer's desired ABSOLUTE
   * assembly-space position along that side's axis (already snapped
   * onto another panel's edge when one is within tolerance — see
   * `alignedEdgeMm`); `WindowEditor` calls `resizePanelEdge`/
   * `resizeSectionEdge` (apps/web/src/lib/window-geometry.ts), same
   * division of labour as `onDividerDrag` above. */
  onPanelEdgeDrag: (panelIndex: number, side: PanelSide, positionMm: number) => void
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
  onDividerDrag,
  onPanelEdgeDrag,
}: WindowDrawingProps) {
  const { outerMm, parts, panelRects } = layout
  const scale = Math.max(outerMm.width, outerMm.height)
  // Any panel with its own grid (a mullion and/or a transom) gets an
  // inner dimension chain of its own (2026-09-14/15, "show sizes
  // outside the drawing") — reserve extra margin for that second tier
  // only when at least one panel actually needs it, so an ungridded
  // window's margin (and every position derived from it below) stays
  // byte-identical to before this feature.
  const anyPanelGridded = panels.some((p) => p.columnWidths.length > 1 || p.rowHeights.length > 1)
  // A coupled (multi-panel) assembly gets its OWN per-window width/height
  // tier too (2026-09-15, "an outer line size for each side not
  // covered") — every panel's free side (per `freeSidesOf`, computed
  // below per-panel) shows that panel's own size, alongside the overall
  // assembly total already drawn further out. Meaningless for a single
  // panel, whose own size already IS the overall total.
  const showPerWindowDims = panels.length > 1
  // Which side is actually free for EACH panel, on each axis — the same
  // check the "+" attach marker already relies on, computed once here
  // and shared by both the per-window callout (`PanelSizeCallout`) and
  // the gridded section chain (`PanelDimensionCallouts`) below, so they
  // can never disagree on "where does this panel's own dimension go"
  // (2026-09-15: "check this image... draw me a suggestion" — the
  // section chain used to be hardcoded to top/left only, which is why
  // Panel 1's own mullion split and Panel 2's own transom split could
  // go missing whenever a panel wasn't flush with the assembly's global
  // corner).
  const panelPlacements = panelRects.map((r) => ({ xMm: r.x, yMm: r.y, widthMm: r.width, heightMm: r.height }))
  // Width prefers BOTTOM now (Mario, 2026-09-16, following the overall
  // line's own move from top to bottom — "you missed another mesurement
  // line at top, move it also") — matches the originally-approved
  // dimension-callouts mock-up in full; height still prefers LEFT,
  // unaffected, since only the width side was ever asked to move.
  const widthSideFor = (i: number): 'top' | 'bottom' | null => {
    const free = freeSidesOf([panelPlacements[i]], panelPlacements)
    return free.includes('bottom') ? 'bottom' : free.includes('top') ? 'top' : null
  }
  const heightSideFor = (i: number): 'left' | 'right' | null => {
    const free = freeSidesOf([panelPlacements[i]], panelPlacements)
    return free.includes('left') ? 'left' : free.includes('right') ? 'right' : null
  }
  // Only the EARLIEST contributor to a shared bottom/left margin gets
  // that margin's leading "gap to the assembly's own edge" segment — a
  // second panel on the same margin (Panel 2 here, whose own bottom is
  // ALSO free) has its own "before" span already covered by the first
  // panel's own chain, not genuinely empty. Real bug caught live
  // (2026-09-15): without this check, Panel 2's per-window width picked
  // up a spurious "2,300" segment — Panel 1's own width, mistaken for
  // an unmeasured gap just because Panel 2 itself doesn't start at
  // x=0. Top/right never get a gap at all (unchanged scoping).
  const widthGapStartXs = panelRects.map((r, i) => (widthSideFor(i) === 'bottom' ? r.x : Infinity))
  const leftStartYs = panelRects.map((r, i) => (heightSideFor(i) === 'left' ? r.y : Infinity))
  const minWidthGapStartX = Math.min(...widthGapStartXs)
  const minLeftStartY = Math.min(...leftStartYs)
  const widthGapFor = (i: number): number | undefined =>
    widthSideFor(i) === 'bottom' && panelRects[i].x === minWidthGapStartX ? panelRects[i].x : undefined
  const leftGapFor = (i: number): number | undefined =>
    heightSideFor(i) === 'left' && panelRects[i].y === minLeftStartY ? panelRects[i].y : undefined
  const wideMargin = anyPanelGridded || showPerWindowDims
  // The margin has to clear the "+" markers as well as the dimension
  // lines now — a marker on the outer edge of the assembly sits a little
  // outside it.
  const margin = scale * (wideMargin ? 0.24 : 0.16)
  // The CAMERA — deliberately decoupled from the content's own size from
  // here on (Mario: "stop resizing the whole window while draging and
  // allow the user to change zoom level to extend more if he want").
  // `baseViewBox` is the fit-to-content view exactly as it looked the
  // FIRST time this window opened — captured once via `useState`'s lazy
  // initializer, which React guarantees never re-runs, so it stays fixed
  // even as `outerMm`/`margin` above keep changing live with every edit.
  // `camera` is the user's own zoom/pan on top of that fixed reference;
  // nothing in this component ever recomputes it from content size again.
  const [baseViewBox] = useState(() => ({
    minX: -margin,
    minY: -margin,
    width: outerMm.width + margin * 2,
    height: outerMm.height + margin * 2,
  }))
  const [camera, setCamera] = useState({ zoom: 1, panX: 0, panY: 0 })
  const viewBox = {
    minX: baseViewBox.minX + camera.panX,
    minY: baseViewBox.minY + camera.panY,
    width: baseViewBox.width / camera.zoom,
    height: baseViewBox.height / camera.zoom,
  }
  const meshCell = scale * 0.02
  // Shrunk from 0.18 (Mario, 2026-09-15, style mockup comparison: "make
  // the end tip or the tip between the section measurement smaller") —
  // applies to every tick mark drawn in this component (overall,
  // per-window, per-section), not just one tier.
  const tickLen = margin * 0.105
  // Shrunk from 0.018 (Mario, 2026-09-16: "make the error icon smaller
  // in this screen") — the badge only needs to read as "something's
  // wrong here," not compete with the part it's sitting on.
  const glyphRadius = scale * 0.011
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

  // Scroll/pinch to zoom, centred on the cursor rather than the
  // viewport's own corner — the point under the cursor stays under it
  // after the zoom, matching Figma/Miro-style canvas zoom. A native
  // (non-React) listener with `{ passive: false }` is required to
  // actually block the page's own scroll on wheel — React's `onWheel`
  // is passive by default and can't reliably `preventDefault()` it.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault()
      const resolved = svgPointFromClient(el, e.clientX, e.clientY)
      if (!resolved) return
      const cursorMm = resolved.point
      setCamera((prev) => {
        const nextZoom = clampZoom(prev.zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
        if (nextZoom === prev.zoom) return prev
        const oldWidth = baseViewBox.width / prev.zoom
        const oldHeight = baseViewBox.height / prev.zoom
        const oldMinX = baseViewBox.minX + prev.panX
        const oldMinY = baseViewBox.minY + prev.panY
        const fx = (cursorMm.x - oldMinX) / oldWidth
        const fy = (cursorMm.y - oldMinY) / oldHeight
        const newWidth = baseViewBox.width / nextZoom
        const newHeight = baseViewBox.height / nextZoom
        return {
          zoom: nextZoom,
          panX: cursorMm.x - fx * newWidth - baseViewBox.minX,
          panY: cursorMm.y - fy * newHeight - baseViewBox.minY,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [baseViewBox])

  // Click-and-drag on empty canvas to pan (Mario's own chosen gesture —
  // "click-and-drag empty canvas to pan"). The background rect this
  // starts from (rendered first, so any real content painted after it
  // wins the same pixel) sizes itself to the CURRENT viewBox, but the
  // drag itself works off screen-pixel deltas from the mousedown point,
  // same posture as the other drag effects in this file — throttled to
  // one `requestAnimationFrame` commit per paint, per the bug-048 lesson
  // (a viewBox-moving drag left uncapped can visibly stutter).
  const [panDrag, setPanDrag] = useState<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number; pxPerMm: number } | null>(
    null,
  )
  useEffect(() => {
    if (!panDrag) return
    let rafId: number | null = null
    let lastClient: { x: number; y: number } | null = null
    const commit = () => {
      rafId = null
      if (!lastClient) return
      const dxMm = (lastClient.x - panDrag.startClientX) / panDrag.pxPerMm
      const dyMm = (lastClient.y - panDrag.startClientY) / panDrag.pxPerMm
      setCamera((c) => ({ ...c, panX: panDrag.startPanX - dxMm, panY: panDrag.startPanY - dyMm }))
    }
    const onMove = (e: globalThis.MouseEvent) => {
      lastClient = { x: e.clientX, y: e.clientY }
      if (rafId === null) rafId = requestAnimationFrame(commit)
    }
    const onUp = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      setPanDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [panDrag])

  // Unchanged position/formula when no extra tier is needed (margin
  // itself is also unchanged then) — either feature pushes this out to
  // 0.2, same as before either existed. The overall WIDTH line moved
  // from the top to the bottom (Mario, 2026-09-16) — this was the one
  // deliberate deviation from the original approved dimension-callouts
  // mock-up (2026-09-15, see cerebrum), kept at the top back then only
  // to avoid relocating an unrelated pre-existing convention; now
  // relocated to match the mock-up's own bottom placement for real.
  const bottomLineY = outerMm.height + (wideMargin ? scale * 0.2 : margin * 0.5)
  const leftLineX = wideMargin ? -scale * 0.2 : -margin * 0.5
  // A gridded panel's OWN column/row chain — only drawn for a panel
  // flush with the assembly's own top/left edge (`panelRect.y === 0` /
  // `.x === 0`), so it always lands in this shared outer margin rather
  // than risking an overlap with a neighbouring panel elsewhere in a
  // multi-panel assembly. Sat much closer to the frame than the overall
  // line at first pass (0.09 vs. topLineY's 0.2), leaving an oversized
  // gap between the two chains — pulled outward to 0.13 so the detail
  // chain reads as adjacent to the overall one, while still leaving
  // clearance for both chains' own tick marks/labels not to touch
  // (Mario, 2026-09-14: "make the detailed dimension line closer to the
  // overall one").
  //
  // The per-window tier (2026-09-15, "an outer line size for each side
  // not covered") shares this EXACT same offset rather than sitting in
  // a tier of its own — `PanelSizeCallout` below suppresses itself on
  // any side where a panel's own column/row chain already draws, so the
  // two are mutually exclusive per side and never actually need to
  // stack (Mario, 2026-09-15: "maximum 2 lines of measurements on any
  // side" — a gridded panel's section chain already sums to its own
  // per-window total, so showing both would just be the same
  // information twice).
  const innerChainOffset = scale * 0.13
  const perWindowChainOffset = innerChainOffset

  // The active panel's own glass outline, iff it has an arched head —
  // bars only ever anchor onto ONE glass pane's outline: the archable
  // TOP ROW's own glass (docs/sections_planing.md §3 — arch is scoped to
  // `cols === 1`, and only section 0 ever gets a `head`), never just
  // whichever glass part happens to come first once a panel can have
  // more than one section's worth of glass.
  const activeGlassPart = parts.find((p) => p.panelIndex === activePanelIndex && p.kind === 'glass' && p.head)
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

  // Which divider (mullion/transom) is being dragged, if any — its full
  // assembly part id (e.g. `"p0:div-v1"`), same posture as `barDrag`
  // above: only local "which thing is mid-drag" state lives here, the
  // actual panel-model edit happens one level up via `onDividerDrag`.
  const [dividerDragId, setDividerDragId] = useState<string | null>(null)

  useEffect(() => {
    if (!dividerDragId) return
    const parsed = parsePartId(dividerDragId)
    const match = parsed ? /^div-(v|h)(\d+)$/.exec(parsed.localId) : null
    const rect = parsed && panelRects[parsed.panelIndex]
    if (!match || !rect) return
    const vertical = match[1] === 'v'
    const onMove = (e: globalThis.MouseEvent) => {
      if (!svgRef.current) return
      const resolved = svgPointFromClient(svgRef.current, e.clientX, e.clientY)
      if (!resolved) return
      // Panel-local mm along the divider's own axis — a mullion (`v`)
      // moves along x, a transom (`h`) along y — matching the space
      // `moveDivider`'s `boundaryMm` expects (see its own doc comment).
      const boundaryMm = vertical ? resolved.point.x - rect.x : resolved.point.y - rect.y
      onDividerDrag(dividerDragId, boundaryMm)
    }
    const onUp = () => setDividerDragId(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dividerDragId, panelRects, onDividerDrag])

  // Which panel's own free outer edge is being dragged, if any — same
  // posture as `dividerDragId` above: local "which thing is mid-drag"
  // state only, the actual panel-model edit happens one level up via
  // `onPanelEdgeDrag`. `edgeAlignment` mirrors what the effect below
  // just found (or didn't) purely so the render can draw the right
  // indicator — it is NEVER read to decide what to send
  // `onPanelEdgeDrag`, the effect already resolved the final position
  // itself before calling it. Two independent kinds, checked in this
  // priority order (2026-09-16, "try snaping to match hight or width
  // again"): a SIZE match (this panel's own resulting width/height
  // equals some OTHER panel's, wherever it sits) actually SNAPS the
  // drag and highlights the matching panel(s); an EDGE match (two
  // panels' edges landing on the exact same coordinate) is
  // indicator-only, unchanged from the earlier "just show the
  // indicator" ask, and is only checked against whatever position the
  // size-match step (if any) already settled on.
  const [edgeDrag, setEdgeDrag] = useState<{ panelIndex: number; side: PanelSide } | null>(null)
  const [edgeAlignment, setEdgeAlignment] = useState<
    { kind: 'edge'; axis: 'x' | 'y'; position: number } | { kind: 'size'; matchedPanelIndices: number[] } | null
  >(null)

  // `panelPlacements` is a fresh array every render (built inline above)
  // — reading it through a ref rather than closing over it directly
  // means the drag effect below never has to list it as a dependency,
  // so its `window` listeners attach ONCE per drag gesture instead of
  // being torn down and rebuilt on every mouse-move-triggered re-render.
  const panelPlacementsRef = useRef(panelPlacements)
  useEffect(() => {
    panelPlacementsRef.current = panelPlacements
  })

  useEffect(() => {
    if (!edgeDrag) return
    const { panelIndex, side } = edgeDrag
    const axis: 'x' | 'y' = side === 'left' || side === 'right' ? 'x' : 'y'
    // A resize re-lays-out every panel's own geometry on every move —
    // committing on every raw `mousemove` let the browser queue up a
    // backlog of stale positions whenever a re-render + revalidate took
    // longer than one frame, which is what read as "a lot of flickering"
    // (Mario, live, bug-048 — filed back when this ALSO moved the SVG's
    // own `viewBox`; the camera is its own fixed thing now, see
    // `baseViewBox`/`camera` above, but the underlying re-render cost
    // this throttle addresses is unchanged). One `requestAnimationFrame`
    // slot coalesces however many mouse-moves land between paints into a
    // single commit, capping the update rate
    // at the display's own refresh rate instead of the input device's.
    let rafId: number | null = null
    let lastClient: { x: number; y: number } | null = null

    const commit = () => {
      rafId = null
      if (!lastClient || !svgRef.current) return
      const resolved = svgPointFromClient(svgRef.current, lastClient.x, lastClient.y)
      if (!resolved) return
      const { point, pxPerMm } = resolved
      const raw = axis === 'x' ? point.x : point.y

      const target = panelPlacementsRef.current[panelIndex]
      if (!target) return
      // SIZE match first — this panel's own resulting width/height
      // against every OTHER panel's, wherever it sits (unlike the edge
      // check below, position is irrelevant here). A real magnet: within
      // tolerance, the drag itself snaps onto the matched size, not just
      // the indicator.
      const dimension: 'width' | 'height' = axis === 'x' ? 'width' : 'height'
      const rawSize = prospectivePanelSize(target, side, raw)
      const sizeToleranceMm = SIZE_MATCH_SNAP_TOLERANCE_PX / pxPerMm
      const matchedSize = matchedPanelSize(panelPlacementsRef.current, panelIndex, dimension, rawSize, sizeToleranceMm)
      const finalPosition = matchedSize !== null ? positionFromPanelSize(target, side, matchedSize) : raw

      if (matchedSize !== null) {
        const matchedPanelIndices = panelPlacementsRef.current
          .map((p, i) => (i !== panelIndex && (dimension === 'width' ? p.widthMm : p.heightMm) === matchedSize ? i : -1))
          .filter((i) => i >= 0)
        setEdgeAlignment({ kind: 'size', matchedPanelIndices })
      } else {
        // EDGE match, indicator only (Mario, earlier: "show indecator
        // only if same mm") — checked against the FINAL position (still
        // just the raw pointer here, since no size match won), rounded
        // first, then an exact (zero-tolerance) coordinate match.
        const snappedEdge = alignedEdgeMm(panelPlacementsRef.current, panelIndex, axis, Math.round(finalPosition), 0)
        setEdgeAlignment(snappedEdge !== null ? { kind: 'edge', axis, position: snappedEdge } : null)
      }
      onPanelEdgeDrag(panelIndex, side, finalPosition)
    }
    const onMove = (e: globalThis.MouseEvent) => {
      lastClient = { x: e.clientX, y: e.clientY }
      if (rafId === null) rafId = requestAnimationFrame(commit)
    }
    const onUp = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      setEdgeDrag(null)
      setEdgeAlignment(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeDrag, onPanelEdgeDrag])

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
    <div
      dir="ltr"
      className="relative h-full w-full"
      onMouseLeave={() => onPanelHover(null)}
      // Same blueprint-style graph-paper grid as the project canvas
      // (`canvas-page.tsx`) — Mario, 2026-09-16: "add grid behind the
      // window workspace." Pure CSS gradients (no image asset), so it
      // costs nothing to load and reuses the exact values already
      // established for visual consistency across both canvases.
      style={{
        backgroundColor: '#ffffff',
        backgroundImage: [
          'linear-gradient(to right, rgba(0,0,0,0.12) 1px, transparent 1px)',
          'linear-gradient(to bottom, rgba(0,0,0,0.12) 1px, transparent 1px)',
          'linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px)',
          'linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '120px 120px, 120px 120px, 20px 20px, 20px 20px',
      }}
    >
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
        aria-label={`${formatDimensionMm(outerMm.width)} × ${formatDimensionMm(outerMm.height)} mm`}
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

        {/* Pan surface — first child, so any real content painted after
            it wins the same pixel; only genuinely empty canvas falls
            through to this. */}
        <rect
          x={viewBox.minX}
          y={viewBox.minY}
          width={viewBox.width}
          height={viewBox.height}
          fill="transparent"
          className={panDrag ? 'cursor-grabbing' : 'cursor-grab'}
          onMouseDown={(e) => {
            if (!svgRef.current) return
            const ctm = svgRef.current.getScreenCTM()
            if (!ctm) return
            e.preventDefault()
            setPanDrag({ startClientX: e.clientX, startClientY: e.clientY, startPanX: camera.panX, startPanY: camera.panY, pxPerMm: ctm.a })
          }}
        />

        {/* Overall assembly dimensions — READ-ONLY. They're derived from
            the panels' bounding box (the API refuses to accept them as
            input at all), so there is nothing here to type into. The
            selected PANEL's own size is editable, but from the side
            panel now, not an overlay on the drawing (Mario, 2026-09-13).
            Plain numbers, no arrowheads — approved mock-up, 2026-09-15. */}
        <g stroke="var(--muted-foreground)" strokeWidth={Math.max(outerMm.width, outerMm.height) * 0.0027} opacity={0.6}>
          <line x1={0} y1={bottomLineY} x2={outerMm.width} y2={bottomLineY} />
          <line x1={0} y1={bottomLineY - tickLen / 2} x2={0} y2={bottomLineY + tickLen / 2} />
          <line x1={outerMm.width} y1={bottomLineY - tickLen / 2} x2={outerMm.width} y2={bottomLineY + tickLen / 2} />
          <line x1={leftLineX} y1={0} x2={leftLineX} y2={outerMm.height} />
          <line x1={leftLineX - tickLen / 2} y1={0} x2={leftLineX + tickLen / 2} y2={0} />
          <line x1={leftLineX - tickLen / 2} y1={outerMm.height} x2={leftLineX + tickLen / 2} y2={outerMm.height} />
        </g>
        <DimensionLabel x={outerMm.width / 2} y={bottomLineY} text={formatDimensionMm(outerMm.width)} fontSize={scale * 0.024} />
        <DimensionLabel x={leftLineX} y={outerMm.height / 2} text={formatDimensionMm(outerMm.height)} fontSize={scale * 0.024} vertical />

        {anyPanelGridded &&
          panels.map((panel, panelIndex) => (
            <PanelDimensionCallouts
              key={`dim-${panelIndex}`}
              panel={panel}
              panelRect={panelRects[panelIndex]}
              outerMm={outerMm}
              parts={parts.filter((p) => p.panelIndex === panelIndex)}
              chainOffset={innerChainOffset}
              tickLen={tickLen}
              fontSize={scale * 0.02}
              letterFontSize={scale * 0.026}
              columnSide={panel.columnWidths.length > 1 ? widthSideFor(panelIndex) : null}
              rowSide={panel.rowHeights.length > 1 ? heightSideFor(panelIndex) : null}
              columnGap={panel.columnWidths.length > 1 ? widthGapFor(panelIndex) : undefined}
              rowGap={panel.rowHeights.length > 1 ? leftGapFor(panelIndex) : undefined}
            />
          ))}

        {showPerWindowDims &&
          panelRects.map((rect, panelIndex) => (
            <PanelSizeCallout
              key={`win-dim-${panelIndex}`}
              rect={rect}
              outerMm={outerMm}
              chainOffset={perWindowChainOffset}
              tickLen={tickLen}
              fontSize={scale * 0.02}
              widthSide={panels[panelIndex].columnWidths.length > 1 ? null : widthSideFor(panelIndex)}
              heightSide={panels[panelIndex].rowHeights.length > 1 ? null : heightSideFor(panelIndex)}
              widthGap={panels[panelIndex].columnWidths.length > 1 ? undefined : widthGapFor(panelIndex)}
              heightGap={panels[panelIndex].rowHeights.length > 1 ? undefined : leftGapFor(panelIndex)}
            />
          ))}

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
            onDividerDragStart={(dividerId) => {
              onSelect(dividerId, false)
              setDividerDragId(dividerId)
            }}
          />
        ))}

        {/* Outer-edge resize handles — one invisible hit-strip per FREE
            side of every panel (never a side another panel already
            occupies; that boundary belongs to a divider or the coupled
            panel's own free side instead). Always present, not gated on
            selection — same posture as a divider's own always-draggable
            bar. */}
        {panelRects.map((rect, panelIndex) => {
          const free = freeSidesOf([panelPlacements[panelIndex]], panelPlacements)
          const thickness = plusRadius * 0.6
          return free.map((side) => {
            const vertical = side === 'left' || side === 'right'
            const x = side === 'right' ? rect.x + rect.width - thickness / 2 : side === 'left' ? rect.x - thickness / 2 : rect.x
            const y = side === 'bottom' ? rect.y + rect.height - thickness / 2 : side === 'top' ? rect.y - thickness / 2 : rect.y
            return (
              <rect
                key={`edge-${panelIndex}-${side}`}
                x={x}
                y={y}
                width={vertical ? thickness : rect.width}
                height={vertical ? rect.height : thickness}
                fill="transparent"
                className={vertical ? 'cursor-ew-resize' : 'cursor-ns-resize'}
                onMouseDown={(e) => {
                  // Without this, the browser starts its own native
                  // text/DOM drag-selection the instant the mouse moves —
                  // which, if the drag point nears the top/bottom of the
                  // (scrollable) editor page, auto-scrolls it to keep
                  // extending the selection. Mario, live: "stop scrolling
                  // while draging the panel side."
                  e.preventDefault()
                  e.stopPropagation()
                  setEdgeDrag({ panelIndex, side })
                }}
              />
            )
          })
        })}

        {/* The EDGE-alignment guide — indicator only, purely visual, lights
            up the instant the dragged edge lands exactly on another
            panel's edge on the same axis. Never active at the same time
            as a size match (the commit effect only ever sets one kind). */}
        {edgeDrag && edgeAlignment?.kind === 'edge' && (
          <line
            x1={edgeAlignment.axis === 'y' ? -margin * 0.6 : edgeAlignment.position}
            x2={edgeAlignment.axis === 'y' ? outerMm.width + margin * 0.6 : edgeAlignment.position}
            y1={edgeAlignment.axis === 'y' ? edgeAlignment.position : -margin * 0.6}
            y2={edgeAlignment.axis === 'y' ? edgeAlignment.position : outerMm.height + margin * 0.6}
            stroke="var(--primary)"
            strokeWidth={strokeWeight * 1.2}
            strokeDasharray={`${plusRadius * 0.4} ${plusRadius * 0.3}`}
            pointerEvents="none"
          />
        )}

        {/* The SIZE-match indicator — the dragged panel's own width/height
            just snapped onto another panel's (wherever it sits); outline
            whichever panel(s) it now matches so it's obvious WHY the drag
            stopped there, same dashed styling as the panel-selection
            outline. */}
        {edgeDrag &&
          edgeAlignment?.kind === 'size' &&
          edgeAlignment.matchedPanelIndices.map((index) => {
            const rect = panelRects[index]
            if (!rect) return null
            return (
              <rect
                key={`size-match-${index}`}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={strokeWeight * 1.2}
                strokeDasharray={`${plusRadius * 0.4} ${plusRadius * 0.3}`}
                pointerEvents="none"
              />
            )
          })}

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
              strokeWidth={strokeWeight * 0.4}
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

      {/* The hover readout chip — arch_windows_planing.md §6.1's
          four-row table. HTML, not SVG text, so its size stays legible
          regardless of the drawing's own zoom (same reasoning the
          removed dimension-input overlay used to rely on). Flips to the
          cursor's other side near the drawing's right edge so it can
          never run out past the viewBox — "near the edge" reuses the
          same margin the viewBox itself pads by. */}
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

      {/* Zoom controls — the manual replacement for the auto-fit-to-content
          behaviour this feature removed (Mario: "allow the user to change
          zoom level to extend more if he want"). Scroll/pinch over the
          drawing zooms too (see the `wheel` effect above); this is just
          the discoverable, precise affordance for the same camera. */}
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-md border border-border bg-card/95 p-1 text-xs shadow-sm backdrop-blur">
        <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Zoom out" onClick={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom / ZOOM_STEP) }))}>
          <Minus className="size-3.5" />
        </Button>
        <button
          type="button"
          className="w-11 text-center tabular-nums text-muted-foreground hover:text-foreground"
          aria-label="Reset zoom"
          onClick={() => setCamera({ zoom: 1, panX: 0, panY: 0 })}
        >
          {Math.round(camera.zoom * 100)}%
        </button>
        <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Zoom in" onClick={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom * ZOOM_STEP) }))}>
          <Plus className="size-3.5" />
        </Button>
      </div>

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
  onDividerDragStart,
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
  /** Mousedown on a divider's own bar — starts a drag (see
   * `WindowDrawing`'s `dividerDragId` state/effect) as well as selecting
   * it, same "select first" posture the bar handles use. */
  onDividerDragStart: (dividerId: string) => void
}) {
  const frame = parts.find((p) => p.kind === 'frame')
  const dividers = parts.filter((p) => p.kind === 'divider')
  const sashes = parts.filter((p) => p.kind === 'sash')
  const glasses = parts.filter((p) => p.kind === 'glass')
  const flyScreens = parts.filter((p) => p.kind === 'flyScreen')
  const doorHinged = isDoorHinged(panel.isDoor, panel.systemType)

  // The panel's own opening — the frame-face inset rect every mullion/
  // transom lives inside (docs/sections_planing.md §3's `openingWidth`/
  // `openingHeight`, mirrored here). True regardless of how many
  // sections or dividers sit inside it — a divider is its own part,
  // drawn on top of this same hole, never widening or narrowing it — so
  // this no longer needs the pre-Sections "no sash anywhere → derive
  // from the glasses' own bounding box" branch, which existed only for
  // the now-deleted TRANSOM panel type (its bar sat at a different inset
  // than `frameFace`, a case that no longer exists).
  const frameOpening = frame && {
    x: frame.rectMm.x + panel.metrics.frameFace,
    y: frame.rectMm.y + panel.metrics.frameFace,
    width: frame.rectMm.width - 2 * panel.metrics.frameFace,
    height: frame.rectMm.height - panel.metrics.frameFace - (doorHinged ? 0 : panel.metrics.frameFace),
  }

  const frameFill = panel.frameHex ?? DEFAULT_FRAME_FILL
  // Every hairline on the panel — part outlines, miters, seams, bead
  // cuts — in one colour derived from the finish (spec §9), so it
  // reads on white and on dark anodised alike. Selection and issue
  // colours still win on the part outlines (`partStroke`).
  const seamStroke = seamColorFor(frameFill)
  const detailStyle: DetailStyle = { frameFill, seamStroke, strokeWeight }

  // Arch-aware frame ring. Only section 0 (the top row of a `cols === 1`
  // panel) can ever be arched (`canHaveArchedHead`) — its sash, or on a
  // fixed light its glass, is the one part in the whole panel that
  // carries a `head`. Finding THAT part directly (rather than assuming
  // the panel has exactly one sash or one glass overall, which a
  // multi-section grid no longer guarantees) is what keeps this from
  // picking up some other row's flat sash by accident.
  const frameOutline = frame && outlineOf(frame)
  const archSash = sashes.find((s) => s.head)
  const archGlass = glasses.find((g) => g.head)
  const innerOutline = archSash ? outlineOf(archSash) : archGlass ? outlineOf(archGlass) : null
  const framePathD =
    frame &&
    (frameOutline && innerOutline
      ? archRingPath(frameOutline, innerOutline)
      : frameOpening &&
        (doorHinged ? openBottomFramePath(frame.rectMm, frameOpening) : ringPath(frame.rectMm, frameOpening)))

  // The one flag `renderFrameDetail` needs for whichever of its two
  // branches actually runs (docs/sections_planing.md §4: "frame miters
  // are unchanged" — kept as a single panel-wide flag rather than a
  // per-edge-segment rule). Arch branch: does the archable section have
  // a sash. Flat branch: does ANY section in the panel have one.
  const frameDetailHasSash = frameOutline ? !!archSash : sashes.length > 0
  // Glasses whose OWN section has no sash — a fixed section's glass gets
  // its bead from the frame's own detail layer; a sash-mounted glass
  // (including a fixed-mullion split of an OPENING section) gets its
  // bead from `renderSashDetail` instead.
  const fixedGlasses = glasses.filter((g) => !sashes.some((s) => s.sectionIndex === g.sectionIndex))

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
            stroke={partStroke(selectedPartId === frame.id, issuesByPart.get(frame.id), seamStroke)}
            strokeWidth={strokeWeight}
          />
          {renderFrameDetail({
            frame,
            frameOpening: frameOpening ?? null,
            frameOutline: frameOutline ?? null,
            innerOutline,
            hasSashes: frameDetailHasSash,
            fixedGlasses,
            doorHinged,
            metrics: panel.metrics,
            style: detailStyle,
          })}
        </InteractivePart>
      )}

      {/* Dividers — one filled bar per mullion/transom in the frame's
          own finish, no seams or miters (decision 10). Drawn right
          after the frame, on the same plane, before anything
          section-level; selectable like any other part. */}
      {dividers.map((divider) => (
        <InteractivePart
          key={divider.id}
          part={divider}
          selected={selectedPartId === divider.id}
          hovered={hoveredPartId === divider.id}
          onSelect={onSelect}
          onHover={onHover}
          issues={issuesByPart.get(divider.id)}
          glyphRadius={glyphRadius}
          onMouseDown={() => onDividerDragStart(divider.id)}
          // A mullion (`div-v{k}`) moves left/right, a transom
          // (`div-h{j}`) moves up/down — the resize cursor reads as a
          // hint that it's draggable, not just clickable.
          cursorClassName={/div-v\d+$/.test(divider.id) ? 'cursor-ew-resize' : 'cursor-ns-resize'}
        >
          {renderDivider(
            divider,
            frameFill,
            partStroke(selectedPartId === divider.id, issuesByPart.get(divider.id), seamStroke),
            strokeWeight,
          )}
        </InteractivePart>
      ))}

      {/* The fly-screen mesh is visual only (pointer-events none) — for
          a hinged/curtain-wall section it fully overlaps the sash/glass
          rect (per the user's own "fill the whole frame" call), so the
          actual hit target is the small handle drawn on top of
          everything else, below. One per opening section that has one. */}
      {flyScreens.map((flyScreen) => {
        const flyScreenOutline = outlineOf(flyScreen)
        return flyScreenOutline ? (
          <path
            key={flyScreen.id}
            d={archOutlinePath(flyScreenOutline)}
            fill={`url(#${meshPatternId})`}
            stroke={MESH_STROKE}
            strokeWidth={MESH_STROKE_WIDTH_MM}
            opacity={0.85}
            pointerEvents="none"
          />
        ) : (
          <rect
            key={flyScreen.id}
            x={flyScreen.rectMm.x}
            y={flyScreen.rectMm.y}
            width={flyScreen.rectMm.width}
            height={flyScreen.rectMm.height}
            fill={`url(#${meshPatternId})`}
            stroke={MESH_STROKE}
            strokeWidth={MESH_STROKE_WIDTH_MM}
            opacity={0.85}
            pointerEvents="none"
          />
        )
      })}

      {/* Painted far-to-near so a sliding sash on a nearer rail covers
          the one behind it — which rail is "nearer" depends on the face
          being viewed (docs/sliding_windows_planing.md §5); non-sliding
          sashes keep their geometry order. */}
      {slidingPaintOrder(sashes, panel.face, panel.slidingRails ?? undefined).map((sash) => {
        // Each sash's own ring runs from its outer rect in to the union
        // of its matching glass panes — same index AND same section:
        // sliding's sashes each hold their own pane, a fixed-mullion
        // opening type gives a single sash TWO panes sharing its index
        // split by the mullion bar, and — now that a panel can have more
        // than one section — two DIFFERENT sections' sashes can share
        // the same local `index` (each section numbers its own sashes
        // from 0), so the section has to match too or this would pull in
        // another section's glass. Same "filled bar, not a centered
        // line" treatment as the frame above.
        const glassesForSash = glasses.filter((g) => g.index === sash.index && g.sectionIndex === sash.sectionIndex)
        if (glassesForSash.length === 0) return null
        const opening = boundingRect(glassesForSash.map((g) => g.rectMm))
        const sashOutline = outlineOf(sash)
        const glassOutline = glassesForSash.length === 1 ? outlineOf(glassesForSash[0]) : null
        // A fixed-mullion bar, unlike a Georgian one, has a real mm
        // width already baked into the geometry (it's the actual gap
        // window-geometry.ts split the two lights by) — draw it at that
        // exact width rather than a proportional guess, or it won't
        // line up with the gap between the two glass rects. Resolved
        // from THIS sash's own section now that opening type is
        // per-section, not per-panel.
        const mullionGrid = mullionGridFor(sectionRenderFor(panel, sash)?.openingType ?? null)
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
              stroke={partStroke(selectedPartId === sash.id, issuesByPart.get(sash.id), seamStroke)}
              strokeWidth={strokeWeight * slidingStrokeScale(sash, panel.face, panel.slidingRails ?? undefined, sashes)}
            />
            {renderSashDetail({
              sash,
              opening,
              sashOutline,
              glassOutline,
              glassesForSash,
              metrics: panel.metrics,
              style: detailStyle,
            })}
            {mullionGrid && glassesForSash.length > 1 && (
              <g pointerEvents="none">{georgianBars(opening, mullionGrid, panel.metrics.sashBarFace, frameFill)}</g>
            )}
          </InteractivePart>
        )
      })}

      {glasses.map((glass) => {
        const glassOutline = outlineOf(glass)
        // Glass colour and the Georgian bar grid are per-SECTION now
        // (docs/sections_planing.md §3), not per-panel.
        const glassSection = sectionRenderFor(panel, glass)
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
                fill={glassSection?.glassHex ?? DEFAULT_GLASS_FILL}
                fillOpacity={GLASS_FILL_OPACITY}
                stroke={partStroke(selectedPartId === glass.id, issuesByPart.get(glass.id), seamStroke)}
                strokeWidth={strokeWeight}
              />
            ) : (
              <rect
                x={glass.rectMm.x}
                y={glass.rectMm.y}
                width={glass.rectMm.width}
                height={glass.rectMm.height}
                fill={glassSection?.glassHex ?? DEFAULT_GLASS_FILL}
                fillOpacity={GLASS_FILL_OPACITY}
                stroke={partStroke(selectedPartId === glass.id, issuesByPart.get(glass.id), seamStroke)}
                strokeWidth={strokeWeight}
              />
            )}
            {renderGasket(glass, glassOutline, strokeWeight)}
            {glassSection?.georgianGrid && (
              <g pointerEvents="none">{georgianBars(glass.rectMm, glassSection.georgianGrid, georgianBarWidth, frameFill)}</g>
            )}
            {/* The bar layer itself — pure visual here; the
                interactive select/highlight/drag overlay for the
                ACTIVE panel's own bars is a separate layer painted
                later in `WindowDrawing` (see its own comment), on top
                of every panel's plain paint below. Bars stay panel-
                level and only ever anchor onto section 0's own arched
                glass outline (docs/sections_planing.md's own
                assumptions), so this still needs no section lookup of
                its own — `glassOutline` alone already picks out that
                one glass. Same width as a Georgian bar
                (`georgianBarWidth`), not the hairline `strokeWeight`
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

      {/* A sliding section's depth cues, on top of every sash and pane:
          the hidden edge of each further sash, dashed where it runs
          behind its nearer neighbour's stile, and one arrow per sash
          for the way it slides (§5). Only once a real layout exists —
          a legacy two-leaf section has no rails to read. */}
      {panel.hasFrame && panel.systemType === SystemType.SLIDING && panel.sections.some((s) => s.sliding) && (
        <g pointerEvents="none">
          {slidingHiddenEdges(sashes, panel.face, panel.slidingRails ?? undefined, strokeWeight * 2).map((edge) => (
            <line
              key={edge.key}
              x1={edge.x}
              y1={edge.y1}
              x2={edge.x}
              y2={edge.y2}
              stroke={seamStroke}
              strokeWidth={strokeWeight}
              strokeDasharray={`${strokeWeight * 5} ${strokeWeight * 4}`}
            />
          ))}
          {renderSlidingSymbols(sashes)}
          {renderSlidingHardware(sashes, panel.face, panel.metrics)}
        </g>
      )}

      {/* The dashed `+` on every fixed light — any system, once the
          frame exists (a frameless placeholder pane is not "fixed",
          it's unspecified). */}
      {panel.hasFrame && <g pointerEvents="none">{renderFixedSymbols(fixedGlasses)}</g>}

      {/* Hardware and the schematic opening-type symbols, grouped by
          SECTION — each section has its own opening type now, so a
          mixed panel (a fixed light beside an opening one, say) must
          not paint one section's hinge symbol using another's type. */}
      {panel.hasFrame &&
        panel.systemType === SystemType.HINGED &&
        Array.from(groupSashesBySection(sashes).entries()).map(([sectionIndex, group]) => {
          const openingType = panel.sections[sectionIndex]?.openingType
          if (!openingType) return null
          return (
            <g key={`hw-${sectionIndex}`} pointerEvents="none">
              {/* `renderHardware`/`renderOpeningTypeSymbols` each return
                  their own root keyed "leaf-0" (or "leaf-0"/"leaf-1" for
                  a double door) — safe as long as they don't land as
                  DIRECT siblings of one another, which merging their two
                  panel-level call sites into one per-section block just
                  made them. Two more wrapper `<g>`s (each un-keyed,
                  since they're plain sequential JSX children, not an
                  array) restore the separate parents each one needs. */}
              <g>{renderHardware(group, openingType, panel.metrics)}</g>
              <g>{renderOpeningTypeSymbols(group, openingType)}</g>
            </g>
          )
        })}

      {/* The fly screen's own hit target — a small pull-handle glyph
          at the bottom edge of its rect, always on top so it stays
          reachable. Its hit box (ringRect) is deliberately just the
          handle itself, not the full mesh rect — the mesh fully
          overlaps the sash/glass beneath it for a hinged/curtain-wall
          section, and a full-rect hit box there would swallow every
          click meant for them. */}
      {flyScreens.map((flyScreen) => {
        const flyScreenHandleRect = {
          x: flyScreen.rectMm.x + flyScreen.rectMm.width / 2 - meshCell * 1.8,
          y: flyScreen.rectMm.y + flyScreen.rectMm.height - meshCell * 0.8,
          width: meshCell * 3.6,
          height: meshCell * 1.6,
        }
        return (
          <InteractivePart
            key={`${flyScreen.id}-handle`}
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
        )
      })}
    </g>
  )
}

/** Groups a panel's own sash parts by their section — a double-door
 * section contributes two sashes under the same key, exactly the array
 * shape `renderHardware`/`renderOpeningTypeSymbols` already expect. */
function groupSashesBySection(sashes: WindowPart[]): Map<number, WindowPart[]> {
  const groups = new Map<number, WindowPart[]>()
  for (const sash of sashes) {
    const key = sash.sectionIndex ?? -1
    const group = groups.get(key)
    if (group) group.push(sash)
    else groups.set(key, [sash])
  }
  return groups
}

/** A dimension-line number with a background-coloured halo so it reads
 * as sitting IN the line rather than crossing it — the standard
 * dimension-chain convention. Bold throughout (Mario, 2026-09-21) —
 * the numbers are what a fabricator reads off the drawing. */
function DimensionLabel({
  x,
  y,
  text,
  fontSize,
  weight = 700,
  vertical = false,
}: {
  x: number
  y: number
  text: string
  fontSize: number
  weight?: number
  vertical?: boolean
}) {
  const w = text.length * fontSize * 0.66 + fontSize * 0.5
  const h = fontSize * 1.4
  const rectW = vertical ? h : w
  const rectH = vertical ? w : h
  return (
    <>
      <rect x={x - rectW / 2} y={y - rectH / 2} width={rectW} height={rectH} fill="var(--background)" />
      <text
        x={x}
        y={y + fontSize * 0.34}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={weight}
        fill="var(--muted-foreground)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        transform={vertical ? `rotate(-90 ${x} ${y})` : undefined}
      >
        {text}
      </text>
    </>
  )
}

/**
 * One tick+label chain along a fixed line — shared by a gridded
 * panel's own column/row breakdown (multiple segments) and the
 * per-window total (a single "segment"), so both draw identically and
 * both get the same optional leading gap for free. `origin` is where
 * the chain's own segments start along the running axis (a panel's own
 * `x`/`y`); `gapBefore` (2026-09-15, "check this image... draw me a
 * suggestion" — the left margin's 620/1680 didn't visually connect to
 * the assembly's own top, leaving a 362mm span unaccounted for)
 * prepends that leftover distance back to the assembly's own edge as
 * one more plain segment — not visually distinct, just another number
 * in the same chain, per Mario's own call.
 */
function DimensionChain({
  orientation,
  fixedCoord,
  origin,
  segments,
  gapBefore,
  tickLen,
  fontSize,
}: {
  orientation: 'horizontal' | 'vertical'
  fixedCoord: number
  origin: number
  segments: number[]
  gapBefore?: number
  tickLen: number
  fontSize: number
}) {
  const allSegments = gapBefore && gapBefore > 0 ? [gapBefore, ...segments] : segments
  const start = gapBefore && gapBefore > 0 ? origin - gapBefore : origin
  const boundaries = cumulativeBoundaries(allSegments)
  const end = start + boundaries[boundaries.length - 1]
  // 1.5× the original 0.06 (Mario, 2026-09-21: "make the line thicker
  // little") — same bump as the overall dimension line above.
  const tickStroke = Math.max(tickLen * 0.09, 1)

  return (
    <>
      <g stroke="var(--muted-foreground)" strokeWidth={tickStroke} opacity={0.6}>
        {orientation === 'horizontal' ? (
          <line x1={start} y1={fixedCoord} x2={end} y2={fixedCoord} />
        ) : (
          <line x1={fixedCoord} y1={start} x2={fixedCoord} y2={end} />
        )}
        {boundaries.map((b, i) =>
          orientation === 'horizontal' ? (
            <line key={i} x1={start + b} y1={fixedCoord - tickLen / 2} x2={start + b} y2={fixedCoord + tickLen / 2} />
          ) : (
            <line key={i} x1={fixedCoord - tickLen / 2} y1={start + b} x2={fixedCoord + tickLen / 2} y2={start + b} />
          ),
        )}
      </g>
      {allSegments.map((len, i) => {
        const mid = start + (boundaries[i] + boundaries[i + 1]) / 2
        return orientation === 'horizontal' ? (
          <DimensionLabel key={i} x={mid} y={fixedCoord} text={formatDimensionMm(len)} fontSize={fontSize} />
        ) : (
          <DimensionLabel key={i} x={fixedCoord} y={mid} text={formatDimensionMm(len)} fontSize={fontSize} vertical />
        )
      })}
    </>
  )
}

/**
 * One panel's own column-width / row-height chain, plus a letter in
 * each of its sections — mock-up approved by Mario 2026-09-15. Only
 * for a gridded panel (a plain 1×1 panel gets neither: nothing to
 * chain, nothing to distinguish). `columnSide`/`rowSide` (computed by
 * the caller via `freeSidesOf`, 2026-09-15 — previously hardcoded to
 * "only if flush with the assembly's global top/left corner", which is
 * why a panel that wasn't flush could lose its own breakdown entirely)
 * say WHICH free side each chain lands on, or `null` if neither side on
 * that axis is free — a panel elsewhere in a multi-panel assembly still
 * gets its section letters either way, just not a chain if nothing's
 * open. The gap-to-the-assembly's-own-edge segment only applies on
 * top/left, matching `DimensionChain`'s own doc comment. Deliberately
 * no opening-type symbols (fixed cross / slide arrow / interlock
 * hatch) — left out of this pass on Mario's own call.
 */
function PanelDimensionCallouts({
  panel,
  panelRect,
  outerMm,
  parts,
  chainOffset,
  tickLen,
  fontSize,
  letterFontSize,
  columnSide,
  rowSide,
  columnGap,
  rowGap,
}: {
  panel: PanelRender
  panelRect: RectMm
  outerMm: { width: number; height: number }
  parts: WindowPart[]
  chainOffset: number
  tickLen: number
  fontSize: number
  letterFontSize: number
  columnSide: 'top' | 'bottom' | null
  rowSide: 'left' | 'right' | null
  columnGap?: number
  rowGap?: number
}) {
  const cols = panel.columnWidths
  const rows = panel.rowHeights
  if (cols.length <= 1 && rows.length <= 1) return null

  return (
    <>
      {cols.length > 1 && columnSide && (
        <DimensionChain
          orientation="horizontal"
          // A SHARED tier across the whole margin, not this one panel's
          // own edge — Mario, 2026-09-15 (annotated screenshot): Panel
          // 1's own chain needs to land on the same row as Panel 2's,
          // even though Panel 1's actual frame sits 362mm lower. Using
          // the assembly's own top/bottom (0 / outerMm.height) rather
          // than `panelRect.y`/`.y + .height` is what makes every
          // panel's chain on a given side line up into one row.
          fixedCoord={columnSide === 'top' ? -chainOffset : outerMm.height + chainOffset}
          origin={panelRect.x}
          segments={cols}
          gapBefore={columnGap}
          tickLen={tickLen}
          fontSize={fontSize}
        />
      )}

      {rows.length > 1 && rowSide && (
        <DimensionChain
          orientation="vertical"
          fixedCoord={rowSide === 'left' ? -chainOffset : outerMm.width + chainOffset}
          origin={panelRect.y}
          segments={rows}
          gapBefore={rowGap}
          tickLen={tickLen}
          fontSize={fontSize}
        />
      )}

      {rows.map((_, r) =>
        cols.map((_, c) => {
          // `parts`' own `rectMm` is already in ASSEMBLY space (see
          // `buildAssemblyLayout`'s own offsetting) — no further
          // `panelRect.x/y` offset belongs here, unlike the chain
          // ticks above, which start from `cumulativeBoundaries`'
          // PANEL-local values and so do need it.
          const sectionIndex = r * cols.length + c
          const sectionParts = parts.filter(
            (p) => p.sectionIndex === sectionIndex && (p.kind === 'sash' || p.kind === 'glass' || p.kind === 'flyScreen'),
          )
          if (sectionParts.length === 0) return null
          const rect = boundingRect(sectionParts.map((p) => p.rectMm))
          return (
            <text
              key={sectionIndex}
              x={rect.x + rect.width / 2}
              y={rect.y + rect.height * 0.92}
              textAnchor="middle"
              fontSize={letterFontSize}
              fontWeight={600}
              fill="var(--foreground)"
            >
              {sectionLetter(sectionIndex)}
            </text>
          )
        }),
      )}
    </>
  )
}

/**
 * One panel's own overall width/height, shown on whichever side is
 * actually free — Mario, 2026-09-15: "if i have two windows next to
 * each other or on top or bottom, i want to see an outerline size for
 * each side of the window not covered". `widthSide`/`heightSide` are
 * resolved by the caller (via the same `widthSideFor`/`heightSideFor`
 * `freeSidesOf` helpers `PanelDimensionCallouts` uses) and already come
 * in as `null` whenever this panel is gridded on that axis — a gridded
 * panel's own column/row chain always wins that side (its segments
 * already sum to this total, so showing both would be a third,
 * redundant line — "maximum 2 lines of measurements on any side",
 * 2026-09-15), never just "gridded AND flush with the corner" the way
 * it briefly was.
 *
 * Suppressed (by the caller resolving to `null`) on whichever axis this
 * panel's own size already MATCHES the assembly-level overall line —
 * Mario, 2026-09-15: "if there's an overall on side no need to add
 * overall on another side if they match".
 *
 * Gains the same leading "gap to the assembly's own edge" segment as
 * `PanelDimensionCallouts`, via the shared `DimensionChain` — a panel
 * whose own chain sits on top/left but doesn't start at 0 gets that
 * leftover distance spelled out too, not left to be inferred from the
 * overall total alone.
 */
function PanelSizeCallout({
  rect,
  outerMm,
  chainOffset,
  tickLen,
  fontSize,
  widthSide,
  heightSide,
  widthGap,
  heightGap,
}: {
  rect: RectMm
  outerMm: { width: number; height: number }
  chainOffset: number
  tickLen: number
  fontSize: number
  widthSide: 'top' | 'bottom' | null
  heightSide: 'left' | 'right' | null
  widthGap?: number
  heightGap?: number
}) {
  const resolvedWidthSide = rect.width === outerMm.width ? null : widthSide
  const resolvedHeightSide = rect.height === outerMm.height ? null : heightSide
  if (!resolvedWidthSide && !resolvedHeightSide) return null

  return (
    <>
      {resolvedWidthSide && (
        <DimensionChain
          orientation="horizontal"
          // Shared with `PanelDimensionCallouts`'s own tier (assembly
          // top/bottom, not this panel's own edge) — see its doc
          // comment: two panels on the same side need to land in the
          // same row.
          fixedCoord={resolvedWidthSide === 'top' ? -chainOffset : outerMm.height + chainOffset}
          origin={rect.x}
          segments={[rect.width]}
          gapBefore={widthGap}
          tickLen={tickLen}
          fontSize={fontSize}
        />
      )}
      {resolvedHeightSide && (
        <DimensionChain
          orientation="vertical"
          fixedCoord={resolvedHeightSide === 'left' ? -chainOffset : outerMm.width + chainOffset}
          origin={rect.y}
          segments={[rect.height]}
          gapBefore={heightGap}
          tickLen={tickLen}
          fontSize={fontSize}
        />
      )}
    </>
  )
}

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

/**
 * The "+" on a free side of the current selection. Sits just outside the
 * edge it would attach to, so it never covers the panel it belongs to.
 * Reachable while hovered because `onPanelHover(null)` only fires on the
 * whole drawing's own `onMouseLeave`, not per-panel — moving from the
 * panel onto this marker (or onto the popup it opens) never counts as
 * leaving. Once the popup itself is open, though, WHICH panel it's
 * attaching to is frozen from the click that opened it
 * (`AddPanelRequest.panelIndices`, `window-editor-page.tsx`) rather than
 * re-read live from hover — see that field's own doc comment for why.
 */
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

function issueStroke(issues: TranslatedIssue[] | undefined): string | null {
  const severity = worstSeverity(issues)
  if (severity === 'error') return ERROR_COLOR
  if (severity === 'warning') return WARNING_COLOR
  return null
}

/** Selected beats an issue beats the panel's own seam colour. */
function partStroke(selected: boolean, issues: TranslatedIssue[] | undefined, seamStroke: string): string {
  if (selected) return 'var(--primary)'
  return issueStroke(issues) ?? seamStroke
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
  onMouseDown,
  cursorClassName = 'cursor-pointer',
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
  /** Divider-only, so far — starts a drag alongside the normal click
   * selection (a click still fires on mouseup if the pointer barely
   * moved, so the two never conflict). */
  onMouseDown?: () => void
  /** Divider-only — `cursor-ew-resize`/`cursor-ns-resize` hints that the
   * part is draggable, not just clickable. */
  cursorClassName?: string
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
      onMouseDown={
        onMouseDown &&
        ((e: MouseEvent<SVGGElement>) => {
          e.stopPropagation()
          onMouseDown()
        })
      }
      className={cn('outline-none', cursorClassName)}
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
