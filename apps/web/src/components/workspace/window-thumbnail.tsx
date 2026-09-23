import { SystemType } from '@repo/types/lookups'
import { type WindowPanelDetail } from '@repo/types/windows'
import { buildAssemblyLayout, type AssemblyPanelInput, type WindowPart } from '@/lib/window-geometry'
import { sectionRenderFor, useResolvedPanels } from '@/lib/window-render'
import {
  DEFAULT_FRAME_FILL,
  DEFAULT_GLASS_FILL,
  GLASS_FILL_OPACITY,
  MESH_STROKE,
  MESH_STROKE_WIDTH_MM,
  archOutlinePath,
  archRingPath,
  barPathsFor,
  boundingRect,
  georgianBars,
  isDoorHinged,
  mullionGridFor,
  openBottomFramePath,
  outlineOf,
  renderDivider,
  renderFrameDetail,
  renderGasket,
  renderHardware,
  renderFixedSymbols,
  renderOpeningTypeSymbols,
  renderSashDetail,
  renderSlidingHardware,
  renderSlidingSymbols,
  ringPath,
  seamColorFor,
  slidingHiddenEdges,
  slidingPaintOrder,
  slidingStrokeScale,
  type DetailStyle,
} from '@/components/workspace/window-shapes'

/**
 * A window's elevation as a static picture — what a canvas card shows.
 *
 * Deliberately NOT `WindowDrawing` with a `readOnly` flag. They paint
 * the same shapes (via window-shapes.tsx, which is where the actual
 * logic lives) but do entirely different things around them: the
 * interactive one owns selection, hover, issue badges, "+" markers and
 * editable dimension inputs, none of which have any meaning on a card.
 * Threading a flag through all of that would make the complicated
 * component more complicated to keep the simple one from existing.
 *
 * No numbers of any kind — no dimension lines, no sizes, no labels. It
 * shows the LAYOUT and the options: how many panels and where, how many
 * sections/sashes each has, which way they open, the frame and glass
 * colours, a fly screen if there is one.
 */
export function WindowThumbnail({
  panels,
  className,
}: {
  panels: WindowPanelDetail[]
  /** Sizing/spacing for the wrapper. The SVG fills it. */
  className?: string
}) {
  // Exterior is the face a card should show — it's the elevation you'd
  // see approaching the building.
  const resolved = useResolvedPanels(panels)

  // `PanelRender` already carries everything `AssemblyPanelInput` needs
  // (docs/sections_planing.md §3 — `SectionRender extends
  // WindowSectionLayoutInput` specifically so this never has to
  // remap section fields); the only thing it doesn't include is
  // `flyScreenAllowed`, resolved separately on `info`.
  const layoutInput: AssemblyPanelInput[] = resolved.map(({ info, render }) => ({
    ...render.placement,
    systemType: render.systemType,
    flyScreenAllowed: info.flyScreenAllowed,
    isDoor: render.isDoor,
    headShape: render.headShape,
    headRiseMm: render.headRiseMm,
    metrics: render.metrics,
    columnWidths: render.columnWidths,
    rowHeights: render.rowHeights,
    sections: render.sections,
  }))
  const { outerMm, parts } = buildAssemblyLayout(layoutInput)

  // A hair of padding so the outermost frame stroke isn't clipped by the
  // viewBox edge. Far tighter than the interactive drawing's margin,
  // which has to leave room for dimension lines and "+" markers.
  const pad = Math.max(outerMm.width, outerMm.height) * 0.02
  const strokeWeight = Math.max(outerMm.width, outerMm.height) * 0.004
  const meshCell = Math.max(outerMm.width, outerMm.height) * 0.03
  const georgianBarWidth = Math.max(outerMm.width, outerMm.height) * 0.012
  const meshPatternId = `thumb-mesh-${Math.round(outerMm.width)}x${Math.round(outerMm.height)}`

  return (
    // Never mirrored in RTL — a technical elevation's left/right carries
    // real meaning (hinge side, which sash overlaps which), same rule as
    // the interactive drawing.
    <div dir="ltr" className={className}>
      <svg
        viewBox={`${-pad} ${-pad} ${outerMm.width + pad * 2} ${outerMm.height + pad * 2}`}
        className="h-full w-full"
        // Decorative: the card's own text names the window. A screen
        // reader gains nothing from an unlabelled elevation.
        aria-hidden="true"
        focusable="false"
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

        {resolved.map(({ render }, panelIndex) => {
          const panelParts = parts.filter((p) => p.panelIndex === panelIndex)
          const frame = panelParts.find((p) => p.kind === 'frame')
          const dividers = panelParts.filter((p) => p.kind === 'divider')
          const sashes = panelParts.filter((p) => p.kind === 'sash')
          const glasses = panelParts.filter((p) => p.kind === 'glass')
          const flyScreens = panelParts.filter((p) => p.kind === 'flyScreen')
          if (!frame) return null

          const doorHinged = isDoorHinged(render.isDoor, render.systemType)
          // The frame-face inset rect every mullion/transom lives
          // inside — see window-drawing.tsx's own comment on why this
          // no longer branches on "any sash in the panel" now that the
          // TRANSOM panel type (a different inset) is gone.
          const frameOpening = {
            x: frame.rectMm.x + render.metrics.frameFace,
            y: frame.rectMm.y + render.metrics.frameFace,
            width: frame.rectMm.width - 2 * render.metrics.frameFace,
            height: frame.rectMm.height - render.metrics.frameFace - (doorHinged ? 0 : render.metrics.frameFace),
          }
          const frameFill = render.frameHex ?? DEFAULT_FRAME_FILL
          // Same finish-derived hairline as the editor (spec §9) — it
          // defines a white frame against the card's light panel and
          // flips lighter on a dark finish, so the card and the editor
          // agree on every outline.
          const outline = seamColorFor(frameFill)
          const detailStyle: DetailStyle = { frameFill, seamStroke: outline, strokeWeight }

          // Arch-aware frame ring — only ever set on section 0 (the top
          // row of a `cols === 1` panel), same lookup as
          // window-drawing.tsx's own `innerOutline`.
          const frameOutline = outlineOf(frame)
          const archSash = sashes.find((s) => s.head)
          const archGlass = glasses.find((g) => g.head)
          const innerOutline = archSash ? outlineOf(archSash) : archGlass ? outlineOf(archGlass) : null
          const framePathD =
            frameOutline && innerOutline
              ? archRingPath(frameOutline, innerOutline)
              : doorHinged
                ? openBottomFramePath(frame.rectMm, frameOpening)
                : ringPath(frame.rectMm, frameOpening)

          const hasSashes = frameOutline ? !!archSash : sashes.length > 0
          const fixedGlasses = glasses.filter((g) => !sashes.some((s) => s.sectionIndex === g.sectionIndex))

          return (
            <g key={panelIndex}>
              <path d={framePathD} fillRule="evenodd" fill={frameFill} stroke={outline} strokeWidth={strokeWeight} />
              {renderFrameDetail({
                frame,
                frameOpening,
                frameOutline,
                innerOutline,
                hasSashes,
                fixedGlasses,
                doorHinged,
                metrics: render.metrics,
                style: detailStyle,
              })}

              {dividers.map((divider) => (
                <g key={divider.id}>{renderDivider(divider, frameFill, outline, strokeWeight)}</g>
              ))}

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
                  />
                )
              })}

              {/* Far-to-near, same as the interactive drawing — see
                  window-shapes.tsx's sliding helpers. */}
              {slidingPaintOrder(sashes, render.face, render.slidingRails ?? undefined).map((sash) => {
                const glassesForSash = glasses.filter((g) => g.index === sash.index && g.sectionIndex === sash.sectionIndex)
                if (glassesForSash.length === 0) return null
                const opening = boundingRect(glassesForSash.map((g) => g.rectMm))
                const sashOutline = outlineOf(sash)
                const glassOutline = glassesForSash.length === 1 ? outlineOf(glassesForSash[0]) : null
                const mullionGrid = mullionGridFor(sectionRenderFor(render, sash)?.openingType ?? null)
                return (
                  <g key={sash.id}>
                    <path
                      d={sashOutline && glassOutline ? archRingPath(sashOutline, glassOutline) : ringPath(sash.rectMm, opening)}
                      fillRule="evenodd"
                      fill={frameFill}
                      stroke={outline}
                      strokeWidth={strokeWeight * slidingStrokeScale(sash, render.face, render.slidingRails ?? undefined, sashes)}
                    />
                    {renderSashDetail({
                      sash,
                      opening,
                      sashOutline,
                      glassOutline,
                      glassesForSash,
                      metrics: render.metrics,
                      style: detailStyle,
                    })}
                    {mullionGrid && glassesForSash.length > 1 &&
                      georgianBars(opening, mullionGrid, render.metrics.sashBarFace, frameFill)}
                  </g>
                )
              })}

              {glasses.map((glass) => {
                const glassOutline = outlineOf(glass)
                const glassSection = sectionRenderFor(render, glass)
                return (
                  <g key={glass.id}>
                    {glassOutline ? (
                      <path
                        d={archOutlinePath(glassOutline)}
                        fill={glassSection?.glassHex ?? DEFAULT_GLASS_FILL}
                        fillOpacity={GLASS_FILL_OPACITY}
                        stroke={outline}
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
                        stroke={outline}
                        strokeWidth={strokeWeight}
                      />
                    )}
                    {renderGasket(glass, glassOutline, strokeWeight)}
                    {glassSection?.georgianGrid &&
                      georgianBars(glass.rectMm, glassSection.georgianGrid, georgianBarWidth, frameFill)}
                    {glassOutline && render.bars.length > 0 &&
                      barPathsFor(render.bars, glassOutline).map((bar) => (
                        <path
                          key={bar.id}
                          d={bar.d}
                          fill="none"
                          stroke={frameFill}
                          strokeWidth={georgianBarWidth}
                        />
                      ))}
                  </g>
                )
              })}

              {/* Sliding depth cues + arrows — the card shows the full
                  elevation detail (decision reversed 2026-09-12), so
                  the same cues as the editor, minus interactivity. */}
              {render.hasFrame && renderFixedSymbols(fixedGlasses)}

              {render.hasFrame && render.systemType === SystemType.SLIDING && render.sections.some((s) => s.sliding) && (
                <g>
                  {slidingHiddenEdges(sashes, render.face, render.slidingRails ?? undefined, strokeWeight * 2).map((edge) => (
                    <line
                      key={edge.key}
                      x1={edge.x}
                      y1={edge.y1}
                      x2={edge.x}
                      y2={edge.y2}
                      stroke={outline}
                      strokeWidth={strokeWeight}
                      strokeDasharray={`${strokeWeight * 5} ${strokeWeight * 4}`}
                    />
                  ))}
                  {renderSlidingSymbols(sashes)}
                  {renderSlidingHardware(sashes, render.face, render.metrics)}
                </g>
              )}

              {render.hasFrame &&
                render.systemType === SystemType.HINGED &&
                Array.from(groupSashesBySection(sashes).entries()).map(([sectionIndex, group]) => {
                  const openingType = render.sections[sectionIndex]?.openingType
                  if (!openingType) return null
                  return (
                    // Two nested wrapper `<g>`s — see window-drawing.tsx's
                    // own comment on this exact spot: `renderHardware`/
                    // `renderOpeningTypeSymbols` each return a root
                    // keyed "leaf-0", which collides once both sit as
                    // direct siblings under the same parent.
                    <g key={`hw-${sectionIndex}`}>
                      <g>{renderHardware(group, openingType, render.metrics)}</g>
                      <g>{renderOpeningTypeSymbols(group, openingType)}</g>
                    </g>
                  )
                })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Groups a panel's own sash parts by their section — a double-door
 * section contributes two sashes under the same key, exactly the array
 * shape `renderHardware`/`renderOpeningTypeSymbols` already expect.
 * Mirrors window-drawing.tsx's own copy: this file takes no dependency
 * on that one (see the doc comment above on why they stay separate
 * components), so the tiny helper is duplicated rather than shared. */
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
