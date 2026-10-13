import { useTranslation } from 'react-i18next'
import { MousePointerClick } from 'lucide-react'
import {
  SLIDING_MAX_SASHES,
  SLIDING_MIN_SASHES,
  resizeSlidingSashes,
  type SlidingLayoutInput,
} from '@repo/types/sliding'
import { SLIDING_PRESETS, slidingPresetLayout, slidingPresetMatching, slidingPresetsFor } from '@repo/types/sliding-presets'
import type { TranslatedIssue } from '@/lib/window-weight'
import { SlidingOpeningTypeIcon } from '@/components/icons/sliding-opening-type-icon'
import { PropertyGroup } from '@/components/workspace/inspector/property-group'
import { PropertyRow, PropertyText } from '@/components/workspace/inspector/property-row'
import { PropertyStepper } from '@/components/workspace/inspector/property-controls'
import { PickerPopover } from '@/components/workspace/inspector/picker-popover'
import { SearchList } from '@/components/workspace/inspector/search-list'

/**
 * A sliding section's Sliding group — docs/inspector_redesign_planing.md
 * §7. Layout (a popover of the presets that fit the frame's rails,
 * grouped by sash count), Sashes (− n +) and Rails (read-only, the frame
 * profile's). Layout and count follow each other both ways (decision
 * 11): a layout sets the count, and a count picks its FIRST layout —
 * also from a custom layout (Mario, 2026-10-12, open question 3). Each
 * sash's rail and direction are set by right-clicking it on the drawing.
 */
export function SlidingLayoutGroup({
  layout,
  rails,
  onChange,
  issues,
}: {
  /** `null` — a saved row from before layouts existed. */
  layout: SlidingLayoutInput | null
  /** The frame profile's rail count; `null` when it has none. */
  rails: number | null
  onChange: (layout: SlidingLayoutInput) => void
  /** Section-level sliding issues (no layout yet). */
  issues: TranslatedIssue[]
}) {
  const { t } = useTranslation('workspace')
  const matching = layout ? slidingPresetMatching(layout) : null
  const count = layout?.sashes.length ?? null

  const onCount = (next: number) => {
    const first = rails === null ? undefined : slidingPresetsFor(next, rails)[0]
    // Every count 2–8 has a 2-rail preset, so this only falls back for a
    // frame with no rail count, where nothing can be offered anyway.
    if (first) onChange(slidingPresetLayout(first))
    else if (layout && rails !== null) onChange(resizeSlidingSashes(layout, next, rails))
  }

  const groups = Array.from({ length: SLIDING_MAX_SASHES - SLIDING_MIN_SASHES + 1 }, (_, i) => SLIDING_MIN_SASHES + i)
    .map((sashes) => ({
      heading: t('windowDialog.inspector.sliding.sashesN', { count: sashes }),
      items: (rails === null ? [] : slidingPresetsFor(sashes, rails)).map((preset) => ({
        value: preset.code,
        label: t(`fields.sliding.presets.${preset.code}`),
        keywords: preset.code,
        lead: <SlidingOpeningTypeIcon layout={slidingPresetLayout(preset)} rails={rails ?? undefined} showPlan={false} className="h-6 w-9" />,
      })),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <PropertyGroup id="section.sliding" title={t('windowDialog.inspector.groups.sliding')}>
      <PropertyRow
        label={t('windowDialog.inspector.rows.layout')}
        htmlFor="sliding-layout"
        required
        issues={issues}
        hint={rails === null ? t('fields.sliding.railsFromProfile') : !layout ? t('fields.sliding.pickLayoutHint') : undefined}
      >
        <PickerPopover
          id="sliding-layout"
          contentClassName="w-84"
          button={{
            lead: layout ? <SlidingOpeningTypeIcon layout={layout} rails={rails ?? undefined} showPlan={false} className="h-5 w-7.5" /> : undefined,
            value: !layout ? '' : matching ? t(`fields.sliding.presets.${matching.code}`) : t('fields.sliding.custom'),
            placeholder: t('fields.sliding.layout'),
            mono: false,
            disabled: rails === null,
          }}
        >
          {(close) => (
            <SearchList
              label={t('fields.sliding.layout')}
              searchPlaceholder={t('windowDialog.inspector.sliding.search')}
              value={matching?.code ?? null}
              groups={groups}
              onPick={(code) => {
                const preset = SLIDING_PRESETS.find((p) => p.code === code)
                if (preset) onChange(slidingPresetLayout(preset))
                close()
              }}
              footer={
                <p className="flex gap-1.5 border-t border-border px-2 pt-2 pb-1 text-[11.5px] text-muted-foreground">
                  <MousePointerClick className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  {t('windowDialog.inspector.sliding.customHint')}
                </p>
              }
            />
          )}
        </PickerPopover>
      </PropertyRow>
      <PropertyRow label={t('windowDialog.inspector.rows.sashes')} htmlFor="sliding-sashes">
        <PropertyStepper
          id="sliding-sashes"
          value={count}
          min={SLIDING_MIN_SASHES}
          max={SLIDING_MAX_SASHES}
          onChange={onCount}
          decreaseLabel={t('windowDialog.inspector.sliding.fewer')}
          increaseLabel={t('windowDialog.inspector.sliding.more')}
        />
      </PropertyRow>
      {rails !== null && (
        <PropertyRow label={t('windowDialog.inspector.rows.rails')}>
          <PropertyText>
            {rails} <span className="font-sans text-muted-foreground">· {t('windowDialog.inspector.sliding.fromFrame')}</span>
          </PropertyText>
        </PropertyRow>
      )}
      {layout && (
        <p className="flex gap-1.5 pt-1 text-[11.5px] leading-snug text-muted-foreground">
          <MousePointerClick className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {t('windowDialog.inspector.sliding.customHint')}
        </p>
      )}
    </PropertyGroup>
  )
}
