import { useMemo } from 'react'
import type { SlidingLayoutInput } from '@repo/types/sliding'
import { buildSlidingIcon, type IconFill } from '@/lib/sliding-icon'

// The sliding counterpart of `opening-type-icon.tsx`: one icon per
// LAYOUT rather than per enum value, since a sliding "opening type" is
// the whole rails-and-sashes arrangement (docs/sliding_windows_planing.md
// decision 9) — which is also what lets the part panel's "Custom" tile
// draw whatever the user has built by hand. The shapes come from
// `lib/sliding-icon.ts` (the prototype's own geometry, always the
// interior view); this file only maps its symbolic fills onto the same
// theme tokens the hinged icons use, so both tile grids read as one
// set in light and dark mode.
const INK = 'var(--foreground)'
const FRAME_FILL = 'var(--muted)'
const SASH_FILL = 'var(--background)'

const fillFor = (fill: IconFill): string =>
  fill === 'ink' ? INK : fill === 'frame' ? FRAME_FILL : fill === 'sash' ? SASH_FILL : 'none'

export function SlidingOpeningTypeIcon({
  layout,
  rails,
  showPlan = true,
  className,
  title,
}: {
  layout: SlidingLayoutInput
  /** The frame profile's rail count (planing §11) — how many lines the
   * plan strip draws. Omitted (a preset tile), the layout's own sashes
   * decide. */
  rails?: number | null
  /** The plan strip under the frame (rails back→front, ▲ = inside). On
   * by default — it's the one place the depth of every rail is spelled
   * out; off for a compact glyph where only the arrows matter. */
  showPlan?: boolean
  className?: string
  title?: string
}) {
  // Keyed on the layout's own content, not its identity: the part panel
  // rebuilds the layout object on every edit, and a preset tile's
  // layout is a fresh object per render.
  const key = `${rails ?? ''}|${layout.sashes.map((s) => `${s.rail}${s.openingType}`).join(',')}|${showPlan}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildSlidingIcon(layout, { showPlan, rails }), [key])

  return (
    <svg viewBox={`0 0 ${model.viewBox.w} ${model.viewBox.h}`} className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {model.shapes.map((s, i) => {
        if (s.kind === 'rect') {
          return (
            <rect
              key={i}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              fill={fillFor(s.fill)}
              stroke={s.stroke > 0 ? INK : undefined}
              strokeWidth={s.stroke || undefined}
              strokeDasharray={s.dash}
            />
          )
        }
        if (s.kind === 'line') {
          return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={INK} strokeWidth={s.stroke} strokeDasharray={s.dash} />
        }
        return (
          <path
            key={i}
            d={s.d}
            fill={fillFor(s.fill)}
            stroke={s.stroke > 0 ? INK : undefined}
            strokeWidth={s.stroke || undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}
