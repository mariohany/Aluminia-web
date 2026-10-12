import type { WindowPart } from '@/lib/window-geometry'
import { loopToSvgPath } from '@/lib/light-graph'
import { partOutlinePath } from '@/components/workspace/window-shapes'
import { cn } from '@/lib/utils'

/**
 * A row's own shape, exactly as the drawing has it (Mario, 2026-10-06:
 * "if a transom is curved show me a curve next to its name") — a
 * divider's band, a light's outline, a panel's frame outline. Scaled
 * into a square at its real proportions, so slants and bows read at
 * their true angle; a divider is filled, so it reads as a bar.
 */
export function PartShapeIcon({ part, className = 'size-3.5' }: { part: WindowPart | undefined; className?: string }) {
  if (!part) return <span className={cn(className, 'shrink-0')} aria-hidden="true" />
  const r = part.rectMm
  const side = Math.max(r.width, r.height, 1)
  const pad = side * 0.06
  const x = r.x + r.width / 2 - side / 2 - pad
  const y = r.y + r.height / 2 - side / 2 - pad
  const divider = part.kind === 'divider'
  const d = divider
    ? part.band
      ? loopToSvgPath(part.band)
      : `M ${r.x} ${r.y} h ${r.width} v ${r.height} h ${-r.width} Z`
    : partOutlinePath(part)
  return (
    <svg className={cn(className, 'shrink-0 opacity-70')} viewBox={`${x} ${y} ${side + 2 * pad} ${side + 2 * pad}`} aria-hidden="true">
      <path d={d} fill={divider ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
