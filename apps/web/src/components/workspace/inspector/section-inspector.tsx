import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { GlassKind, HingedOpeningType, SectionKind } from '@repo/types/windows'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import { sectionLetter } from '@/lib/window-geometry'
import { dedupeIssues, type TranslatedIssue } from '@/lib/window-weight'
import type { MergedSystemProfileSummary } from '@/lib/lookup-merge'
import { cn } from '@/lib/utils'
import { OpeningTypeIcon } from '@/components/icons/opening-type-icon'
import { PartShapeIcon } from '@/components/workspace/part-shape-icon'
import { SlidingLayoutGroup } from '@/components/workspace/inspector/sliding-layout-group'
import { InspectorChip, InspectorHeader, InspectorIssueChip } from '@/components/workspace/inspector/inspector-header'
import { PropertyGroup } from '@/components/workspace/inspector/property-group'
import { PropertyRow, PropertyText } from '@/components/workspace/inspector/property-row'
import { PropertyNumber, PropertySegment, PropertySwitch } from '@/components/workspace/inspector/property-controls'
import { PickerPopover, Swatch } from '@/components/workspace/inspector/picker-popover'
import { SearchList, type SearchListItem } from '@/components/workspace/inspector/search-list'
import { DOOR_OPENING_TYPES, WINDOW_OPENING_TYPES } from '@/components/workspace/inspector/opening-types'
import type { WindowPartPanelProps } from '@/components/workspace/window-part-panel'

const isSlidingIssue = (issue: TranslatedIssue) => issue.messageKey.startsWith('sliding')

/**
 * The Section level of the inspector — docs/inspector_redesign_planing.md
 * §5/§6: one light's own settings. Light (kind, size), then Opening
 * (type, sash, fly screen, weight) or Glazing (bead), then Glass, then a
 * read-only "From Panel N" with a way back to the panel. A sliding
 * section adds its Sliding group (layout, sash count, rails, §7).
 */
export function SectionInspector({ props }: { props: WindowPartPanelProps }) {
  const { t } = useTranslation('workspace')
  const section = props.activeSection
  const n = props.panelIndex + 1
  const isOpening = section.kind === SectionKind.OPENING

  // This view always describes ONE section — its parts are whichever
  // sash/glass/fly screen carry its `sectionIndex`.
  const sectionParts = props.layout.parts.filter(
    (p) => (p.kind === 'sash' || p.kind === 'glass' || p.kind === 'flyScreen') && p.sectionIndex === section.sectionIndex,
  )
  const sashPart = sectionParts.find((p) => p.kind === 'sash')
  const glassPart = sectionParts.find((p) => p.kind === 'glass')
  const flyScreenPart = sectionParts.find((p) => p.kind === 'flyScreen')
  const issuesOf = (kind: string) => dedupeIssues(sectionParts.filter((p) => p.kind === kind).flatMap((p) => props.issuesByPart.get(p.id) ?? []))
  const allIssues = dedupeIssues(sectionParts.flatMap((p) => props.issuesByPart.get(p.id) ?? []))

  // A sliding sash's own build issues (blocked, slides into the frame…)
  // show in the Issues panel and on the drawing only — the sash's rail
  // and direction are set by right-click now (planing §8). A
  // section-level sliding issue (no layout yet) lands on the first glass
  // part and shows under the Layout row.
  const sashIssues = issuesOf('sash').filter((i) => !isSlidingIssue(i) && i.messageKey !== 'sashWeightExceeded')
  const glassAll = issuesOf('glass')
  const slidingSectionIssues = glassAll.filter(isSlidingIssue)
  const glassIssues = glassAll.filter((i) => !isSlidingIssue(i) && i.messageKey !== 'beadRequired')
  const beadIssues = glassAll.filter((i) => i.messageKey === 'beadRequired')
  const flyScreenIssues = flyScreenPart ? (props.issuesByPart.get(flyScreenPart.id) ?? []) : []

  // "Section A" once a divider makes it one; an undivided panel's only
  // light is just "Light" (Mario, 2026-09-20: no section heading on 1×1).
  const title = props.isGridded ? `${t('windowDialog.design.sections.section')} ${sectionLetter(section.sectionIndex)}` : t('windowDialog.inspector.light')
  const panelLabel = t('windowDialog.design.structure.panel', { index: n })

  const sizeHint = (part: (typeof sectionParts)[number] | undefined) =>
    part ? t('windowDialog.design.computedSize', { width: Math.round(part.rectMm.width), height: Math.round(part.rectMm.height) }) : undefined

  const profileItems = (options: MergedSystemProfileSummary[]): SearchListItem[] =>
    options.map((o) => ({
      value: formatScopedRef(o.scope, o.id),
      label: o.profileNo,
      keywords: o.catalogName ?? '',
      sub: t('windowDialog.inspector.maxThickness', { max: o.maxGlassThickness }),
    }))
  const profileNo = (options: MergedSystemProfileSummary[], ref: string) => options.find((o) => formatScopedRef(o.scope, o.id) === ref)?.profileNo ?? ''

  const openingSelected = (type: HingedOpeningType) =>
    type === HingedOpeningType.FIXED_CLOSED ? !isOpening || section.openingType === HingedOpeningType.FIXED_CLOSED : section.openingType === type
  const openingItem = (type: HingedOpeningType): SearchListItem => ({
    value: type,
    label: t(`fields.openingTypeLabels.${type}`),
    lead: <OpeningTypeIcon type={type} className="h-6 w-5" />,
  })
  const currentOpening = isOpening ? (section.openingType ?? null) : HingedOpeningType.FIXED_CLOSED

  const overWeight = section.sashWeightKg !== null && section.maxSashWeight !== null && section.sashWeightKg > section.maxSashWeight
  const colourHex = (value: string | null) => props.colorOptions.find((o) => o.value === value)?.hex ?? null
  const colourLabel = (value: string | null) => props.colorOptions.find((o) => o.value === value)?.label ?? '—'
  const glassLabel = props.activeSection.glassOptions.find((o) => o.value === section.glassValue)?.label ?? ''

  return (
    <div className="flex flex-col">
      <InspectorHeader
        crumb={`${panelLabel} › ${title}`}
        title={title}
        thumb={<PartShapeIcon part={glassPart ?? sashPart} className="size-10" />}
        chips={
          <>
            <InspectorChip tone={isOpening ? 'primary' : 'neutral'}>{t(`windowDialog.design.section.kind.${section.kind}`)}</InspectorChip>
            <InspectorIssueChip issues={allIssues} />
          </>
        }
      />

      <PropertyGroup id="section.light" title={t('windowDialog.inspector.groups.light')} first>
        {section.fixedOnly ? (
          <p className="py-1 text-xs text-muted-foreground">{t('windowDialog.design.section.archLightFixed')}</p>
        ) : (
          // Sliding too: the segment replaced its old Fixed tile; Opening
          // brings back the layout it had (rememberedSlidingLayouts).
          <PropertyRow label={t('windowDialog.inspector.rows.kind')} htmlFor="section-kind">
            <PropertySegment
              id="section-kind"
              label={t('windowDialog.inspector.rows.kind')}
              value={section.kind}
              options={[SectionKind.FIXED, SectionKind.OPENING].map((kind) => ({ value: kind, label: t(`windowDialog.design.section.kind.${kind}`) }))}
              onChange={section.onKindChange}
            />
          </PropertyRow>
        )}
        {props.isGridded && section.widthMm !== null && section.heightMm !== null && (
          <>
            <PropertyRow label={t('windowDialog.inspector.rows.width')} htmlFor="section-width">
              <PropertyNumber id="section-width" value={section.widthMm} onCommit={section.onWidthChange} />
            </PropertyRow>
            <PropertyRow label={t('windowDialog.inspector.rows.height')} htmlFor="section-height">
              <PropertyNumber id="section-height" value={section.heightMm} onCommit={section.onHeightChange} />
            </PropertyRow>
          </>
        )}
      </PropertyGroup>

      {!section.fixedOnly && section.isSliding && isOpening && (
        <SlidingLayoutGroup
          layout={section.slidingLayout}
          rails={section.slidingRails}
          onChange={section.onSlidingLayoutChange}
          issues={slidingSectionIssues}
        />
      )}

      {isOpening ? (
        <PropertyGroup id="section.opening" title={t('windowDialog.inspector.groups.opening')}>
          {!section.fixedOnly && section.showOpeningTypes && (
            <PropertyRow label={t('windowDialog.inspector.rows.type')} htmlFor="section-opening-type">
              <PickerPopover
                id="section-opening-type"
                contentClassName="w-72"
                button={{
                  lead: currentOpening ? <OpeningTypeIcon type={currentOpening} className="h-5 w-4" /> : undefined,
                  value: currentOpening ? t(`fields.openingTypeLabels.${currentOpening}`) : '',
                  placeholder: t('fields.openingTypeSection'),
                  mono: false,
                }}
              >
                {(close) => (
                  <SearchList
                    label={t('fields.openingTypeSection')}
                    searchPlaceholder={t('windowDialog.inspector.opening.search')}
                    value={[...WINDOW_OPENING_TYPES, ...DOOR_OPENING_TYPES].find(openingSelected) ?? null}
                    groups={[
                      { heading: t('windowDialog.inspector.opening.windows'), items: WINDOW_OPENING_TYPES.map(openingItem) },
                      { heading: t('windowDialog.inspector.opening.doors'), items: DOOR_OPENING_TYPES.map(openingItem) },
                    ]}
                    onPick={(type) => {
                      section.onOpeningTypeChange(type as HingedOpeningType)
                      close()
                    }}
                    // Door types are always selectable; picking one turns
                    // the panel's Door on (Mario, 2026-10-12).
                    footer={
                      props.showDoor && !props.isDoor ? (
                        <p className="border-t border-border px-2 pt-2 pb-1 text-[11.5px] text-muted-foreground">
                          {t('windowDialog.inspector.opening.doorNote', { n })}
                        </p>
                      ) : undefined
                    }
                  />
                )}
              </PickerPopover>
            </PropertyRow>
          )}
          <PropertyRow label={t('windowDialog.inspector.rows.sash')} htmlFor="section-sash" required issues={sashIssues} hint={sizeHint(sashPart)}>
            <PickerPopover
              id="section-sash"
              button={{
                value: profileNo(section.sashOptions, section.sashProfile),
                placeholder: section.sashOptions.length === 0 ? t('fields.sashProfileNeedsFrame') : t('fields.sashProfilePlaceholder'),
                disabled: section.sashOptions.length === 0,
                invalid: sashIssues.some((i) => i.messageKey === 'sashRequired'),
              }}
            >
              {(close) => (
                <SearchList
                  label={t('windowDialog.inspector.rows.sash')}
                  searchPlaceholder={t('windowDialog.inspector.search.profiles')}
                  searchable={section.sashOptions.length > 6}
                  value={section.sashProfile || null}
                  groups={[{ items: profileItems(section.sashOptions) }]}
                  onPick={(ref) => {
                    section.onSashChange(ref as ScopedRef)
                    close()
                  }}
                />
              )}
            </PickerPopover>
          </PropertyRow>
          <PropertyRow
            label={t('windowDialog.inspector.rows.flyScreen')}
            htmlFor="section-fly-screen"
            issues={flyScreenIssues}
          >
            <PropertySwitch
              id="section-fly-screen"
              checked={section.hasFlyScreen}
              disabled={!section.flyScreenAllowed}
              title={!section.flyScreenAllowed ? t('fields.flyScreenDisabledHint') : undefined}
              onCheckedChange={section.onFlyScreenChange}
              aria-label={t('fields.hasFlyScreen')}
            />
          </PropertyRow>
          {section.sashWeightKg !== null && (
            <PropertyRow label={t('windowDialog.inspector.rows.weight')}>
              <WeightMeter kg={section.sashWeightKg} max={section.maxSashWeight} over={overWeight} />
            </PropertyRow>
          )}
        </PropertyGroup>
      ) : (
        <PropertyGroup id="section.glazing" title={t('windowDialog.inspector.groups.glazing')}>
          <PropertyRow label={t('windowDialog.inspector.rows.bead')} htmlFor="section-bead" required issues={beadIssues}>
            <PickerPopover
              id="section-bead"
              button={{
                value: profileNo(section.beadOptions, section.beadProfile),
                placeholder: section.beadOptions.length === 0 ? t('fields.beadProfileNeedsFrame') : t('fields.beadProfilePlaceholder'),
                disabled: section.beadOptions.length === 0,
                invalid: beadIssues.length > 0,
              }}
            >
              {(close) => (
                <SearchList
                  label={t('windowDialog.inspector.rows.bead')}
                  searchPlaceholder={t('windowDialog.inspector.search.profiles')}
                  searchable={section.beadOptions.length > 6}
                  value={section.beadProfile || null}
                  groups={[{ items: profileItems(section.beadOptions) }]}
                  onPick={(ref) => {
                    section.onBeadChange(ref as ScopedRef)
                    close()
                  }}
                />
              )}
            </PickerPopover>
          </PropertyRow>
        </PropertyGroup>
      )}

      <PropertyGroup id="section.glass" title={t('windowDialog.inspector.groups.glass')}>
        <PropertyRow label={t('windowDialog.inspector.rows.glass')} htmlFor="section-glass" required issues={glassIssues} hint={sizeHint(glassPart)}>
          <PickerPopover
            id="section-glass"
            button={{
              value: glassLabel,
              mono: false,
              placeholder:
                section.glassOptions.length > 0 ? t('fields.glassPlaceholder') : isOpening ? t('fields.glassNeedsSash') : t('fields.glassNeedsBead'),
              disabled: section.glassOptions.length === 0,
              invalid: glassIssues.some((i) => i.severity === 'error'),
            }}
          >
            {(close) => (
              <SearchList
                label={t('windowDialog.inspector.rows.glass')}
                searchPlaceholder={t('windowDialog.inspector.search.glass')}
                searchable={section.glassOptions.length > 6}
                value={section.glassValue || null}
                groups={[{ items: section.glassOptions.map((o) => ({ value: o.value, label: o.label })) }]}
                onPick={(value) => {
                  const [kind, ref] = value.split('|') as [GlassKind, ScopedRef]
                  section.onGlassChange(kind, ref)
                  close()
                }}
              />
            )}
          </PickerPopover>
        </PropertyRow>
        {section.maxGlassAllowed !== null && (
          <PropertyRow label={t('windowDialog.inspector.rows.thickness')}>
            <span
              className="px-2 font-mono text-[12.5px]"
              title={
                isOpening
                  ? t('fields.glassDisclaimer', { max: section.maxGlassAllowed, sashMax: section.sashMaxGlassThickness })
                  : t('fields.glassDisclaimerBead', { max: section.maxGlassAllowed, beadMax: section.beadMaxGlassThickness })
              }
            >
              {t('windowDialog.inspector.maxThickness', { max: section.maxGlassAllowed })}
            </span>
          </PropertyRow>
        )}
      </PropertyGroup>

      <PropertyGroup id="section.fromPanel" title={t('windowDialog.inspector.groups.fromPanel', { n })} defaultOpen={false}>
        <PropertyRow label={t('windowDialog.inspector.rows.frame')}>
          <PropertyText>{props.frame.profileNo ?? '—'}</PropertyText>
        </PropertyRow>
        <PropertyRow label={t('windowDialog.inspector.rows.colours')}>
          <span className="flex items-center gap-1.5 px-2 font-mono text-[12px]">
            <Swatch hex={colourHex(props.interiorColor)} />
            {colourLabel(props.interiorColor)}
            <Swatch hex={colourHex(props.exteriorColor)} className="ms-1.5" />
            {colourLabel(props.exteriorColor)}
          </span>
        </PropertyRow>
        <button
          type="button"
          onClick={() => props.onSelectPart(`p${props.panelIndex}:frame`)}
          className="mt-1 flex items-center gap-1 self-start rounded-md text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('windowDialog.inspector.editOnPanel', { n })}
          <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
        </button>
      </PropertyGroup>
    </div>
  )
}

/** Estimated sash weight against the catalogue limit — amber over it. */
function WeightMeter({ kg, max, over }: { kg: number; max: number | null; over: boolean }) {
  const { t } = useTranslation('workspace')
  const pct = max ? Math.min(100, (kg / max) * 100) : 0
  return (
    <span className="flex w-full items-center gap-2 px-2">
      {max !== null && (
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className={cn('block h-full rounded-full', over ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className={cn('shrink-0 font-mono text-[12px]', over && 'font-medium text-amber-600 dark:text-amber-500')}>
        {t('windowDialog.inspector.weightValue', { weight: Math.round(kg * 10) / 10, max: max ?? '—' })}
      </span>
    </span>
  )
}
