import { SystemType } from '@repo/types/lookups'
import type { WindowPanelDetail } from '@repo/types/windows'
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
  boundingRect,
  georgianBars,
  isDoorHinged,
  mullionGridFor,
  openBottomFramePath,
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

  const layoutInput: AssemblyPanelInput[] = panels.map((panel, i) => ({
    xMm: panel.xMm,
    yMm: panel.yMm,
    widthMm: panel.widthMm,
    heightMm: panel.heightMm,
    systemType: resolved[i].info.systemType,
    hasFlyScreen: panel.hasFlyScreen,
    flyScreenAllowed: resolved[i].info.flyScreenAllowed,
    isDoor: panel.isDoor,
    openingType: panel.openingType,
  }))
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
          const frameOpening = {
            x: frame.rectMm.x + NOMINAL_FRAME_FACE_MM,
            y: frame.rectMm.y + NOMINAL_FRAME_FACE_MM,
            width: frame.rectMm.width - 2 * NOMINAL_FRAME_FACE_MM,
            height: frame.rectMm.height - NOMINAL_FRAME_FACE_MM - (doorHinged ? 0 : NOMINAL_FRAME_FACE_MM),
          }
          const frameFill = render.frameHex ?? DEFAULT_FRAME_FILL
          const mullionGrid = mullionGridFor(render.openingType)

          return (
            <g key={panelIndex}>
              <path
                d={doorHinged ? openBottomFramePath(frame.rectMm, frameOpening) : ringPath(frame.rectMm, frameOpening)}
                fillRule="evenodd"
                fill={frameFill}
                stroke={outline}
                strokeOpacity={outlineOpacity}
                strokeWidth={strokeWeight}
              />

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
                />
              )}

              {sashes.map((sash) => {
                const glassesForSash = glasses.filter((g) => g.index === sash.index)
                if (glassesForSash.length === 0) return null
                const opening = boundingRect(glassesForSash.map((g) => g.rectMm))
                return (
                  <g key={sash.id}>
                    <path
                      d={ringPath(sash.rectMm, opening)}
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

              {glasses.map((glass) => (
                <g key={glass.id}>
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
                  {render.georgianGrid &&
                    georgianBars(glass.rectMm, render.georgianGrid, georgianBarWidth, frameFill)}
                </g>
              ))}

              {render.hasFrame && render.systemType === SystemType.HINGED && render.openingType &&
                renderOpeningTypeSymbols(sashes, render.openingType)}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
