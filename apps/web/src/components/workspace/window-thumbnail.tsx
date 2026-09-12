import { SystemType } from '@repo/types/lookups'
import { PanelType, type WindowPanelDetail } from '@repo/types/windows'
import {
  NOMINAL_FRAME_FACE_MM,
  NOMINAL_MULLION_BAR_MM,
  NOMINAL_SASH_FACE_MM,
  buildAssemblyLayout,
  type AssemblyPanelInput,
} from '@/lib/window-geometry'
import { useResolvedPanels } from '@/lib/window-render'
import {
  DEFAULT_FRAME_FILL,
  DEFAULT_GLASS_FILL,
  GLASS_FILL_OPACITY,
  MESH_STROKE,
  archOutlinePath,
  archRingPath,
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
 * sashes each has, which way they open, the frame and glass colours, a
 * fly screen if there is one.
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
  const resolved = useResolvedPanels(panels, 'exterior')

  // Branches per `panelType`, same as `window-dialog.tsx`'s own
  // `layoutInput` (docs/transom_tasks.md Step 5) — a saved window can
  // genuinely contain a transom now. Found and fixed while finishing
  // Step 7: this file is `useResolvedPanels`'s SECOND real consumer,
  // and hardcoding `panelType: PanelType.WINDOW` here regardless of
  // the panel's own real type was never updated when window-dialog.tsx
  // was — a saved transom would have been handed to `buildWindowLayout`
  // as if it had a frame/sash it doesn't, drawing a fake sash ring
  // inside what should be a plain bar.
  const layoutInput: AssemblyPanelInput[] = panels.map((panel, i) =>
    panel.panelType === PanelType.WINDOW
      ? {
          panelType: PanelType.WINDOW,
          xMm: panel.xMm,
          yMm: panel.yMm,
          widthMm: panel.widthMm,
          heightMm: panel.heightMm,
          systemType: resolved[i].info.systemType,
          hasFlyScreen: panel.hasFlyScreen,
          flyScreenAllowed: resolved[i].info.flyScreenAllowed,
          isDoor: panel.isDoor,
          openingType: panel.openingType,
          headShape: panel.headShape,
          headRiseMm: panel.headRiseMm,
        }
      : {
          panelType: PanelType.TRANSOM,
          xMm: panel.xMm,
          yMm: panel.yMm,
          widthMm: panel.widthMm,
          heightMm: panel.heightMm,
        },
  )
  const { outerMm, parts } = buildAssemblyLayout(layoutInput)

  // A hair of padding so the outermost frame stroke isn't clipped by the
  // viewBox edge. Far tighter than the interactive drawing's margin,
  // which has to leave room for dimension lines and "+" markers.
  // `--border` is too faint to define a WHITE frame (the default when
  // no colour is picked) against the card's own light panel — the
  // profile disappears and the window reads as a floating pane of
  // glass. A muted foreground at low opacity outlines both a white and
  // a coloured frame without competing with the fill.
  const outline = 'var(--muted-foreground)'
  const outlineOpacity = 0.45

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
          const sashes = panelParts.filter((p) => p.kind === 'sash')
          const glasses = panelParts.filter((p) => p.kind === 'glass')
          const flyScreen = panelParts.find((p) => p.kind === 'flyScreen')
          if (!frame) return null

          const doorHinged = isDoorHinged(render.isDoor, render.systemType)
          // A transom has no sash — see window-drawing.tsx's own
          // `frameOpening` comment (same bug, same fix, duplicated
          // here for the same pre-existing reason the arch-aware
          // comment just below already notes).
          const frameOpening =
            sashes.length > 0
              ? {
                  x: frame.rectMm.x + NOMINAL_FRAME_FACE_MM,
                  y: frame.rectMm.y + NOMINAL_FRAME_FACE_MM,
                  width: frame.rectMm.width - 2 * NOMINAL_FRAME_FACE_MM,
                  height: frame.rectMm.height - NOMINAL_FRAME_FACE_MM - (doorHinged ? 0 : NOMINAL_FRAME_FACE_MM),
                }
              : boundingRect(glasses.map((g) => g.rectMm))
          const frameFill = render.frameHex ?? DEFAULT_FRAME_FILL
          const mullionGrid = mullionGridFor(render.openingType)

          // Arch-aware frame ring — only ever set when `buildWindowLayout`
          // judged the panel `archable` (a single, non-door sash), in
          // which case the frame's own opening IS that sash's rect, so
          // there's no separate outline to derive: read it straight off
          // the one sash instead of hand-computing it a second way, the
          // same "trust the built part" rule `frameOpening` above already
          // breaks for every non-arch case (a pre-existing, untouched
          // duplication this only avoids repeating for the new one).
          const frameOutline = outlineOf(frame)
          const singleSashOutline = sashes.length === 1 ? outlineOf(sashes[0]) : null
          const framePathD =
            frameOutline && singleSashOutline
              ? archRingPath(frameOutline, singleSashOutline)
              : doorHinged
                ? openBottomFramePath(frame.rectMm, frameOpening)
                : ringPath(frame.rectMm, frameOpening)

          return (
            <g key={panelIndex}>
              <path
                d={framePathD}
                fillRule="evenodd"
                fill={frameFill}
                stroke={outline}
                strokeOpacity={outlineOpacity}
                strokeWidth={strokeWeight}
              />

              {flyScreen && (() => {
                const flyScreenOutline = outlineOf(flyScreen)
                return flyScreenOutline ? (
                  <path
                    d={archOutlinePath(flyScreenOutline)}
                    fill={`url(#${meshPatternId})`}
                    stroke={MESH_STROKE}
                    strokeWidth={NOMINAL_SASH_FACE_MM * 0.25}
                    opacity={0.85}
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
                  />
                )
              })()}

              {sashes.map((sash) => {
                const glassesForSash = glasses.filter((g) => g.index === sash.index)
                if (glassesForSash.length === 0) return null
                const opening = boundingRect(glassesForSash.map((g) => g.rectMm))
                const sashOutline = outlineOf(sash)
                const glassOutline = glassesForSash.length === 1 ? outlineOf(glassesForSash[0]) : null
                return (
                  <g key={sash.id}>
                    <path
                      d={sashOutline && glassOutline ? archRingPath(sashOutline, glassOutline) : ringPath(sash.rectMm, opening)}
                      fillRule="evenodd"
                      fill={frameFill}
                      stroke={outline}
                      strokeOpacity={outlineOpacity}
                      strokeWidth={strokeWeight}
                    />
                    {mullionGrid && glassesForSash.length > 1 &&
                      georgianBars(opening, mullionGrid, NOMINAL_MULLION_BAR_MM, frameFill)}
                  </g>
                )
              })}

              {glasses.map((glass) => {
                const glassOutline = outlineOf(glass)
                return (
                  <g key={glass.id}>
                    {glassOutline ? (
                      <path
                        d={archOutlinePath(glassOutline)}
                        fill={render.glassHex ?? DEFAULT_GLASS_FILL}
                        fillOpacity={GLASS_FILL_OPACITY}
                        stroke={outline}
                        strokeOpacity={outlineOpacity}
                        strokeWidth={strokeWeight}
                      />
                    ) : (
                      <rect
                        x={glass.rectMm.x}
                        y={glass.rectMm.y}
                        width={glass.rectMm.width}
                        height={glass.rectMm.height}
                        fill={render.glassHex ?? DEFAULT_GLASS_FILL}
                        fillOpacity={GLASS_FILL_OPACITY}
                        stroke={outline}
                        strokeOpacity={outlineOpacity}
                        strokeWidth={strokeWeight}
                      />
                    )}
                    {render.georgianGrid &&
                      georgianBars(glass.rectMm, render.georgianGrid, georgianBarWidth, frameFill)}
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

              {render.hasFrame && render.systemType === SystemType.HINGED && render.openingType &&
                renderOpeningTypeSymbols(sashes, render.openingType)}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
