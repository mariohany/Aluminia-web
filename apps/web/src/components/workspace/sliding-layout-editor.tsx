import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { HingedOpeningType, SectionKind } from '@repo/types/windows'
import {
  SLIDING_MAX_SASHES,
  SLIDING_MIN_SASHES,
  SlidingDirectionSource,
  SlidingOpeningType,
  resizeSlidingSashes,
  resolveSlidingLayout,
  suggestSlidingOpeningType,
  type SlidingLayoutInput,
} from '@repo/types/sliding'
import { slidingPresetLayout, slidingPresetMatching, slidingPresetsFor } from '@repo/types/sliding-presets'
import { cn } from '@/lib/utils'
import type { TranslatedIssue } from '@/lib/window-weight'
import { FieldLabel } from '@/components/workspace/field-label'
import { IssueList } from '@/components/workspace/issue-list'
import { SlidingOpeningTypeIcon } from '@/components/icons/sliding-opening-type-icon'
import { OpeningTypeIcon } from '@/components/icons/opening-type-icon'

/**
 * A sliding section's sashes editor — docs/sliding_windows_planing.md
 * §7, the part panel's replacement for the hinged opening-type grid.
 * Top to bottom: sash count, the preset tiles for that count that fit
 * the frame's rails plus a "Custom" tile drawing whatever is currently
 * set, then one row per sash (rail, move back/forward, direction with
 * the suggested one marked, Auto/Manual).
 *
 * The rail COUNT is not edited here (planing §11, 2026-09-20): it's
 * the frame profile's (`rails`) — not shown as a number at all (Mario,
 * 2026-09-20), only implied by the plan strips under the tiles; changed
 * on the profile in the Data page. `rails === null` — a
 * sliding frame whose profile has no count — shows only the hint; the
 * frame-level `slidingRailsRequired` issue says what to do.
 *
 * Every edit leaves through ONE `onChange(layout)` with the layout
 * already re-derived (`resolveSlidingLayout`) — the editor page then
 * writes it with `shouldDirty: true`, so the panel, the context menu
 * and the keyboard can't disagree about what a change means.
 *
 * `layout === null` is a sliding section with no layout yet — a saved
 * row from before the field existed (decision 5: never backfilled,
 * flagged instead). The controls then show as "nothing picked" and any
 * tile click or sash count writes a fresh layout.
 *
 * The tile grid doubles as the fixed/opening choice (Mario, 2026-09-20
 * — "same as the fixed option in hinged"): a Fixed tile leads the
 * presets, exactly like `FIXED_CLOSED` leads the hinged type grid, so
 * the separate Fixed/Opening toggle is gone for sliding. While `kind`
 * is fixed, only the tiles show (no sash count, no rows); picking a
 * preset from there flips the section back to opening in the same
 * write (`window-editor-page.tsx`'s `setSlidingLayoutOf`).
 */
export function SlidingLayoutEditor({
  layout,
  rails,
  kind,
  onFixed,
  onChange,
  issues,
  issuesBySash,
}: {
  layout: SlidingLayoutInput | null
  /** The frame profile's rail count; `null` when it has none. */
  rails: number | null
  kind: SectionKind
  /** The Fixed tile — the caller drops the layout (and remembers it). */
  onFixed: () => void
  onChange: (layout: SlidingLayoutInput) => void
  /** The section's own sliding issues (no layout yet, layout on a
   * non-sliding frame) — shown under the tiles. */
  issues: TranslatedIssue[]
  /** Already-translated, keyed by sash index — each row shows its own. */
  issuesBySash: Map<number, TranslatedIssue[]>
}) {
  const { t } = useTranslation('workspace')

  // With no layout yet, the preset grid still needs a sash count to
  // show tiles for — a local choice until a tile is clicked.
  const [browseCount, setBrowseCount] = useState(SLIDING_MIN_SASHES)
  const sashCount = layout?.sashes.length ?? browseCount
  const presets = rails === null ? [] : slidingPresetsFor(sashCount, rails)
  const isFixed = kind === SectionKind.FIXED
  const matching = layout && !isFixed ? slidingPresetMatching(layout) : null
  const sashRails = layout?.sashes.map((s) => s.rail) ?? []

  const emit = (next: SlidingLayoutInput) => onChange(resolveSlidingLayout(next))

  const onSashCountChange = (count: number) => {
    if (!layout || rails === null) {
      setBrowseCount(count)
      return
    }
    // A preset stays a preset at the new count (its first one that fits
    // the frame); a custom layout keeps what it has and grows on the
    // front rail / shrinks from the right (planing §7 step 2).
    const preset = matching ? slidingPresetsFor(count, rails)[0] : null
    emit(preset ? slidingPresetLayout(preset) : resizeSlidingSashes(layout, count, rails))
  }

  const updateSash = (index: number, changes: Partial<SlidingLayoutInput['sashes'][number]>) => {
    if (!layout) return
    emit({ ...layout, sashes: layout.sashes.map((sash, i) => (i === index ? { ...sash, ...changes } : sash)) })
  }

  // "Inside" is the PROFILE's front rail; a sash beyond it is just
  // "Rail N" — its own row's error says it's off the frame.
  const railLabel = (rail: number) =>
    rail === 0
      ? t('fields.sliding.railOutside')
      : rails !== null && rail === rails - 1
        ? t('fields.sliding.railInside')
        : t('fields.sliding.railN', { n: rail + 1 })

  return (
    <div className="flex flex-col gap-3">
      {/* No rail count here — it's the frame profile's (planing §11) and
          only shows up as the plan strip under each layout tile. */}
      {!isFixed && (
        <Segmented
          id="sliding-sashes"
          label={t('fields.sliding.sashes')}
          value={layout ? sashCount : null}
          options={range(SLIDING_MIN_SASHES, SLIDING_MAX_SASHES)}
          onChange={onSashCountChange}
        />
      )}

      <div>
        <FieldLabel htmlFor="sliding-layout" required>
          {t('fields.sliding.layout')}
        </FieldLabel>
        {rails === null && <p className="mt-1 text-xs text-muted-foreground">{t('fields.sliding.railsFromProfile')}</p>}
        {rails !== null && !layout && !isFixed && (
          <p className="mt-1 text-xs text-muted-foreground">{t('fields.sliding.pickLayoutHint')}</p>
        )}
        <div id="sliding-layout" role="group" aria-label={t('fields.sliding.layout')} className="mt-1.5 grid grid-cols-4 gap-1">
          {/* Fixed leads the grid, the hinged grid's own `FIXED_CLOSED`
              posture — same glyph, same place. */}
          <button
            type="button"
            title={t('fields.openingTypeLabels.fixed_closed')}
            aria-label={t('fields.openingTypeLabels.fixed_closed')}
            aria-pressed={isFixed}
            onClick={onFixed}
            className={cn(
              'flex items-center justify-center rounded-md border p-1 transition-colors',
              isFixed ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground',
            )}
          >
            <OpeningTypeIcon type={HingedOpeningType.FIXED_CLOSED} className="size-full" />
          </button>
          {presets.map((preset) => {
            const selected = matching?.code === preset.code
            const label = t(`fields.sliding.presets.${preset.code}`)
            return (
              <button
                key={preset.code}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={selected}
                onClick={() => emit(slidingPresetLayout(preset))}
                className={cn(
                  'flex items-center justify-center rounded-md border p-1 transition-colors',
                  selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground',
                )}
              >
                <SlidingOpeningTypeIcon layout={slidingPresetLayout(preset)} className="size-full" />
              </button>
            )
          })}
          {/* The Custom tile is a state indicator, not a button: it's
              selected exactly when nothing above matches (decision 3),
              and draws whatever the rows below have built. */}
          {layout && !isFixed && (
            <div
              role="img"
              aria-label={t('fields.sliding.custom')}
              title={t('fields.sliding.custom')}
              className={cn(
                'relative flex items-center justify-center rounded-md border p-1',
                matching ? 'border-dashed border-border opacity-60' : 'border-primary bg-primary/5',
              )}
            >
              <SlidingOpeningTypeIcon layout={layout} rails={rails} className="size-full" />
              <span className="absolute inset-x-0 bottom-0 truncate text-center text-[9px] leading-tight text-muted-foreground">
                {t('fields.sliding.custom')}
              </span>
            </div>
          )}
        </div>
        <IssueList issues={issues} />
      </div>

      {layout && !isFixed && (
        <ol className="flex flex-col gap-2">
          {layout.sashes.map((sash, index) => {
            const suggested = suggestSlidingOpeningType(sashRails, index)
            const isAuto = sash.directionSource === SlidingDirectionSource.AUTO
            const issues = issuesBySash.get(index) ?? []
            return (
              <li key={index} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{t('fields.sliding.sashN', { n: index + 1 })}</span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      title={t('fields.sliding.moveBack')}
                      aria-label={t('fields.sliding.moveBack')}
                      disabled={sash.rail === 0}
                      onClick={() => updateSash(index, { rail: sash.rail - 1 })}
                      className="rounded border border-border p-0.5 hover:border-muted-foreground disabled:opacity-40"
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>
                    <span className="text-xs text-muted-foreground">{railLabel(sash.rail)}</span>
                    <button
                      type="button"
                      title={t('fields.sliding.moveForward')}
                      aria-label={t('fields.sliding.moveForward')}
                      disabled={rails === null || sash.rail >= rails - 1}
                      onClick={() => updateSash(index, { rail: sash.rail + 1 })}
                      className="rounded border border-border p-0.5 hover:border-muted-foreground disabled:opacity-40"
                    >
                      <ChevronRight className="size-3.5" />
                    </button>
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <span role="group" aria-label={t('fields.sliding.direction')} className="flex gap-1">
                    {DIRECTION_OPTIONS.map(({ type, glyph }) => {
                      const selected = sash.openingType === type
                      const label = t(`fields.sliding.types.${type}`)
                      return (
                        <button
                          key={type}
                          type="button"
                          title={suggested === type ? `${label} — ${t('fields.sliding.suggested')}` : label}
                          aria-label={label}
                          aria-pressed={selected}
                          onClick={() => updateSash(index, { openingType: type, directionSource: SlidingDirectionSource.MANUAL })}
                          className={cn(
                            'relative flex size-7 items-center justify-center rounded-md border text-sm transition-colors',
                            selected ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:border-muted-foreground',
                          )}
                        >
                          {glyph}
                          {suggested === type && <span aria-hidden="true" className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />}
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
                        onClick={() => updateSash(index, { directionSource: SlidingDirectionSource.AUTO })}
                        className="rounded border border-border p-0.5 hover:border-muted-foreground"
                      >
                        <RotateCcw className="size-3" />
                      </button>
                    )}
                  </span>
                </div>
                <IssueList issues={issues} />
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

const DIRECTION_OPTIONS: { type: SlidingOpeningType; glyph: string }[] = [
  { type: SlidingOpeningType.LEFT, glyph: '←' },
  { type: SlidingOpeningType.FREE, glyph: '↔' },
  { type: SlidingOpeningType.RIGHT, glyph: '→' },
]

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function Segmented({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: number | null
  options: number[]
  onChange: (value: number) => void
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div id={id} role="group" aria-label={label} className="mt-1.5 flex gap-1">
        {options.map((option) => {
          const selected = value === option
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option)}
              className={cn(
                'min-w-7 flex-1 rounded-md border px-1.5 py-1 text-xs transition-colors',
                selected ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:border-muted-foreground',
              )}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}
