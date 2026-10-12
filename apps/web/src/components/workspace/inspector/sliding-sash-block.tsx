import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import {
  SlidingDirectionSource,
  SlidingOpeningType,
  suggestSlidingOpeningType,
  type SlidingSashInput,
} from '@repo/types/sliding'
import { cn } from '@/lib/utils'

const DIRECTIONS: { type: SlidingOpeningType; glyph: string }[] = [
  { type: SlidingOpeningType.LEFT, glyph: '←' },
  { type: SlidingOpeningType.FREE, glyph: '↔' },
  { type: SlidingOpeningType.RIGHT, glyph: '→' },
]

export type SlidingSashChange = { changes: Partial<SlidingSashInput>; label: 'moveSash' | 'changeSlidingDirection' }

/**
 * One sliding sash's rail and direction — docs/inspector_redesign_planing.md
 * §8. The old side-panel row, kept as it looked (Mario, 2026-10-12: "keep
 * the old design … not another design"), now opened by right-clicking
 * the sash: its title, the rail tiles, ← ↔ → with the rails' suggestion
 * dotted, and Auto/Manual with a reset. Nothing is disabled — a layout
 * that can't be built is allowed and reported in Issues.
 */
export function SlidingSashBlock({
  index,
  sash,
  sashRails,
  rails,
  onChange,
}: {
  index: number
  sash: SlidingSashInput
  /** Every sash's rail, left → right — the direction suggestion reads them. */
  sashRails: number[]
  /** The frame profile's rail count (0 when it has none). */
  rails: number
  onChange: (change: SlidingSashChange) => void
}) {
  const { t } = useTranslation('workspace')
  const suggested = suggestSlidingOpeningType(sashRails, index)
  const isAuto = sash.directionSource === SlidingDirectionSource.AUTO
  // A sash already beyond the frame's rails still shows its own tile, so
  // the way back is visible.
  const tiles = Math.max(rails, sash.rail + 1, 2)

  // "Inside" is the PROFILE's front rail; a tile beyond it is "Rail N".
  const railLabel = (rail: number) =>
    rail === 0 ? t('fields.sliding.railOutside') : rail === rails - 1 ? t('fields.sliding.railInside') : t('fields.sliding.railN', { n: rail + 1 })

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <span className="text-xs font-medium">{t('fields.sliding.sashN', { n: index + 1 })}</span>

      <div role="group" aria-label={t('windowDialog.inspector.sliding.rail')} className="flex gap-1">
        {Array.from({ length: tiles }, (_, rail) => {
          const selected = sash.rail === rail
          return (
            <button
              key={rail}
              type="button"
              aria-pressed={selected}
              aria-label={railLabel(rail)}
              title={railLabel(rail)}
              onClick={() => {
                if (!selected) onChange({ changes: { rail }, label: 'moveSash' })
              }}
              className={cn(
                'flex h-8 flex-1 items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              <RailGlyph rails={tiles} own={rail} />
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1">
        <span role="group" aria-label={t('fields.sliding.direction')} className="flex gap-1">
          {DIRECTIONS.map(({ type, glyph }) => {
            const selected = sash.openingType === type
            const label = t(`fields.sliding.types.${type}`)
            return (
              <button
                key={type}
                type="button"
                title={suggested === type ? `${label} — ${t('fields.sliding.suggested')}` : label}
                aria-label={label}
                aria-pressed={selected}
                onClick={() => onChange({ changes: { openingType: type, directionSource: SlidingDirectionSource.MANUAL }, label: 'changeSlidingDirection' })}
                className={cn(
                  'relative flex size-7 items-center justify-center rounded-md border text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:border-muted-foreground',
                )}
              >
                {glyph}
                {suggested === type && <span aria-hidden="true" className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" />}
              </button>
            )
          })}
        </span>
        <span className="ms-auto flex items-center gap-1 text-xs text-muted-foreground">
          {isAuto ? t('fields.sliding.auto') : t('fields.sliding.manual')}
          {!isAuto && (
            <button
              type="button"
              title={t('fields.sliding.resetAuto')}
              aria-label={t('fields.sliding.resetAuto')}
              onClick={() => onChange({ changes: { directionSource: SlidingDirectionSource.AUTO }, label: 'changeSlidingDirection' })}
              className="rounded border border-border p-0.5 hover:border-muted-foreground"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

/** A rail tile's drawing — every rail of the frame as a line, outside
 * at the top, this tile's own rail bold (variant 2, Mario 2026-10-12).
 * Physical, so never mirrored in RTL. */
function RailGlyph({ rails, own }: { rails: number; own: number }) {
  const top = 6
  const bottom = 18
  const gap = rails > 1 ? (bottom - top) / (rails - 1) : 0
  return (
    <svg viewBox="0 0 40 24" className="h-5 w-10" aria-hidden="true">
      {Array.from({ length: rails }, (_, rail) => {
        const y = top + rail * gap
        const mine = rail === own
        return (
          <line
            key={rail}
            x1={4}
            x2={36}
            y1={y}
            y2={y}
            stroke="currentColor"
            strokeWidth={mine ? 3 : 1}
            strokeLinecap="round"
            opacity={mine ? 1 : 0.45}
          />
        )
      })}
    </svg>
  )
}
