import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { HeadShape, SectionKind } from '@repo/types/windows'
import { ProfileType } from '@repo/types/lookups'
import type { ScopedRef } from '@repo/types/company-lookups'
import { formatDimensionMm, sectionLetter } from '@repo/geometry/window-geometry'
import { minGothicRiseMm, normalizeHeadRise, type HeadOutline } from '@repo/geometry/arch-geometry'
import type { TranslatedIssue } from '@/lib/window-weight'
import { archOutlinePath } from '@/components/workspace/window-shapes'
import { PartShapeIcon } from '@/components/workspace/part-shape-icon'
import { ProfileSearchPicker } from '@/components/workspace/profile-search-picker'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'
import { InspectorChip, InspectorHeader, InspectorIssueChip } from '@/components/workspace/inspector/inspector-header'
import { PropertyGroup } from '@/components/workspace/inspector/property-group'
import { PropertyRow, PropertyText } from '@/components/workspace/inspector/property-row'
import { PropertyNumber, PropertySegment, PropertySwitch } from '@/components/workspace/inspector/property-controls'
import { ColourList, PickerPopover, Swatch } from '@/components/workspace/inspector/picker-popover'
import type { WindowPartPanelProps } from '@/components/workspace/window-part-panel'

const HEAD_SHAPE_OPTIONS: HeadShape[] = [HeadShape.FLAT, HeadShape.ROUND, HeadShape.SEGMENTAL, HeadShape.GOTHIC]

// Fixed demo outlines for the head-shape icons — not the panel's own
// rect. `round`'s rise is the real formula (width / 2); segmental and
// gothic are just representative enough to read as "shallow" and
// "pointed" at icon size.
const HEAD_SHAPE_ICON_OUTLINES: Record<HeadShape, HeadOutline> = {
  [HeadShape.FLAT]: { rect: { x: 2, y: 2, width: 36, height: 42 }, shape: HeadShape.FLAT, riseMm: 0 },
  [HeadShape.ROUND]: { rect: { x: 2, y: 2, width: 36, height: 42 }, shape: HeadShape.ROUND, riseMm: 18 },
  [HeadShape.SEGMENTAL]: { rect: { x: 2, y: 2, width: 36, height: 42 }, shape: HeadShape.SEGMENTAL, riseMm: 10 },
  [HeadShape.GOTHIC]: { rect: { x: 2, y: 2, width: 36, height: 42 }, shape: HeadShape.GOTHIC, riseMm: 31 },
}

/**
 * The Panel level of the inspector — docs/inspector_redesign_planing.md
 * §4. Shown when the frame, a panel row, or nothing is selected: the
 * header card, then Frame, Size & shape, Finish, Dividers (once the
 * panel has one) and the panel's Lights, each light a link to its own
 * Section view.
 */
export function PanelInspector({ props, issues }: { props: WindowPartPanelProps; issues: TranslatedIssue[] }) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')
  const n = props.panelIndex + 1
  const panelLabel = t('windowDialog.design.structure.panel', { index: n })
  const frame = props.frame
  const ownParts = props.layout.parts
  const frameFace = props.frameFaceMm

  const lightCaption = (section: WindowPartPanelProps['sections'][number]): string => {
    if (section.kind === SectionKind.FIXED) return t('windowDialog.design.section.kind.fixed')
    if (section.openingType) return t(`fields.openingTypeLabels.${section.openingType}`)
    return t('windowDialog.design.section.kind.opening')
  }
  const lightPart = (sectionIndex: number) =>
    ownParts.find((p) => p.sectionIndex === sectionIndex && p.kind === 'glass') ?? ownParts.find((p) => p.sectionIndex === sectionIndex)

  const roundTooWide = props.widthMm / 2 >= props.heightMm
  const headOptions = HEAD_SHAPE_OPTIONS.map((shape) => {
    // A semicircle that wide needs more height than the panel has —
    // disabled rather than silently drawn flatter than "round" promises.
    const tooWide = shape === HeadShape.ROUND && roundTooWide
    const label = t(`fields.headShapeLabels.${shape}`)
    return {
      value: shape,
      label,
      disabled: !props.headShapeAllowed || tooWide,
      disabledReason: !props.headShapeAllowed ? t('fields.headShapeDisabledHint') : tooWide ? t('fields.headShapeRoundTooWideHint') : undefined,
      icon: (
        <svg viewBox="0 0 40 46" className="h-5 w-4.5" aria-hidden="true">
          <path d={archOutlinePath(HEAD_SHAPE_ICON_OUTLINES[shape])} fill="none" stroke="currentColor" strokeWidth="2.5" />
        </svg>
      ),
    }
  })

  const colourHex = (value: string | null) => props.colorOptions.find((o) => o.value === value)?.hex ?? null
  const colourLabel = (value: string | null) => props.colorOptions.find((o) => o.value === value)?.label ?? ''

  const colourRow = (id: string, label: string, value: string | null, onChange: (value: string | null) => void) => (
    <PropertyRow label={label} htmlFor={id}>
      <PickerPopover
        id={id}
        contentClassName="w-56 p-1.5"
        button={{ lead: value ? <Swatch hex={colourHex(value)} /> : undefined, value: colourLabel(value), placeholder: t('fields.colorPlaceholder') }}
      >
        {(close) => (
          <ColourList
            value={value}
            options={props.colorOptions}
            noneLabel={t('fields.colorPlaceholder')}
            onPick={(next) => {
              onChange(next)
              close()
            }}
          />
        )}
      </PickerPopover>
    </PropertyRow>
  )

  return (
    <div className="flex flex-col">
      <InspectorHeader
        crumb={`${t('windowDialog.inspector.crumbs.window')} › ${panelLabel}`}
        title={panelLabel}
        thumb={<PartShapeIcon part={ownParts.find((p) => p.kind === 'frame')} className="size-10" />}
        chips={
          <>
            {props.systemType && <InspectorChip>{tLookups(`systemType.${props.systemType}`)}</InspectorChip>}
            <InspectorIssueChip issues={issues} />
          </>
        }
        actions={
          props.panelCount > 1
            ? [{ label: t('windowDialog.design.deletePanel'), onSelect: props.onDeletePanel, disabledReason: props.deleteDisabledReason, destructive: true }]
            : []
        }
      />

      <PropertyGroup id="panel.frame" title={t('windowDialog.inspector.groups.frame')} first>
        <PropertyRow label={t('windowDialog.inspector.rows.profile')} htmlFor="panel-frame" required error={frame.error}>
          <PickerPopover
            id="panel-frame"
            contentClassName="w-84"
            button={{
              value: frame.profileNo ?? '',
              placeholder: t('fields.frameProfile'),
              sub: frame.catalogName,
              favourite: !!frame.value && frame.value === frame.favoriteRef,
              invalid: !!frame.error,
            }}
          >
            {(close) => (
              <ProfileSearchPicker
                profileType={ProfileType.FRAME}
                value={frame.value}
                onChange={(ref) => {
                  frame.onChange(ref)
                  close()
                }}
                favoriteRef={frame.favoriteRef}
                onSetFavorite={frame.onSetFavorite}
                preferredCatalogRef={frame.preferredCatalogRef}
                preferredBrandRef={frame.preferredBrandRef}
              />
            )}
          </PickerPopover>
        </PropertyRow>
        {frame.systemName && (
          <PropertyRow label={t('windowDialog.inspector.rows.system')}>
            <PropertyText mono={false}>{frame.systemName}</PropertyText>
          </PropertyRow>
        )}
      </PropertyGroup>

      <PropertyGroup id="panel.size" title={t('windowDialog.inspector.groups.sizeShape')}>
        <PropertyRow label={t('windowDialog.inspector.rows.width')} htmlFor="panel-width" required error={props.widthError}>
          <PropertyNumber id="panel-width" value={Number.isFinite(props.widthMm) ? props.widthMm : null} onCommit={props.onWidthChange} invalid={!!props.widthError} />
        </PropertyRow>
        <PropertyRow label={t('windowDialog.inspector.rows.height')} htmlFor="panel-height" required error={props.heightError}>
          <PropertyNumber id="panel-height" value={Number.isFinite(props.heightMm) ? props.heightMm : null} onCommit={props.onHeightChange} invalid={!!props.heightError} />
        </PropertyRow>
        <PropertyRow label={t('windowDialog.inspector.rows.head')} htmlFor="panel-head-shape">
          <PropertySegment
            id="panel-head-shape"
            label={t('fields.headShapeSection')}
            value={props.headShape}
            options={headOptions}
            onChange={props.onHeadShapeChange}
          />
        </PropertyRow>
        {props.headShape !== HeadShape.FLAT && (
          <PropertyRow label={t('windowDialog.inspector.rows.rise')} htmlFor="panel-head-rise">
            <PropertyNumber
              id="panel-head-rise"
              value={
                props.headShape === HeadShape.ROUND
                  ? Math.round(normalizeHeadRise(HeadShape.ROUND, props.widthMm, 0, props.heightMm, frameFace))
                  : (props.headRiseMm ?? 0)
              }
              onCommit={props.onHeadRiseChange}
              // A round head's rise is always half its width.
              disabled={props.headShape === HeadShape.ROUND}
              // Below this a gothic head's arcs cross instead of meeting
              // at a point (minGothicRiseMm); above the max the springing
              // line falls inside the sill (normalizeHeadRise).
              min={props.headShape === HeadShape.GOTHIC ? Math.ceil(minGothicRiseMm(props.widthMm)) + 1 : 1}
              max={Math.max(Math.floor(normalizeHeadRise(props.headShape, props.widthMm, props.heightMm, props.heightMm, frameFace)), 1)}
            />
          </PropertyRow>
        )}
        {props.showDoor && (
          <PropertyRow label={t('windowDialog.inspector.rows.door')} htmlFor="panel-door">
            <PropertySwitch id="panel-door" checked={props.isDoor} onCheckedChange={props.onDoorChange} aria-label={t('fields.isDoor')} />
          </PropertyRow>
        )}
      </PropertyGroup>

      <PropertyGroup id="panel.finish" title={t('windowDialog.inspector.groups.finish')}>
        {colourRow('panel-interior-color', t('windowDialog.inspector.rows.interior'), props.interiorColor, props.onInteriorColorChange)}
        {colourRow('panel-exterior-color', t('windowDialog.inspector.rows.exterior'), props.exteriorColor, props.onExteriorColorChange)}
      </PropertyGroup>

      {/* One divider profile for the whole panel (sections_planing.md
          decision 4): appears with the first divider, required from then
          on, and only from the frame's own catalogue. */}
      {props.isGridded && (
        <PropertyGroup id="panel.dividers" title={t('windowDialog.inspector.groups.dividers')} right={props.dividerCount}>
          <PropertyRow
            label={t('windowDialog.inspector.rows.defaultDivider')}
            htmlFor="panel-divider-profile"
            required
            error={props.dividerProfileError}
          >
            <PickerPopover
              id="panel-divider-profile"
              contentClassName="h-[26rem] w-[22rem]"
              button={{ value: props.dividerProfileNo ?? '', placeholder: t('fields.dividerProfile'), invalid: !!props.dividerProfileError }}
            >
              {(close) => (
                <ProfileTreePicker
                  profileType={ProfileType.TRANSOM}
                  value={props.dividerProfile}
                  onChange={(ref: ScopedRef) => {
                    props.onDividerProfileChange(ref)
                    close()
                  }}
                  catalogRef={props.frameCatalogRef}
                />
              )}
            </PickerPopover>
          </PropertyRow>
        </PropertyGroup>
      )}

      <PropertyGroup id="panel.lights" title={t('windowDialog.inspector.groups.lights')} right={props.sections.length}>
        {props.sections.map((section, sectionIndex) => {
          const part = lightPart(sectionIndex)
          return (
            <button
              key={sectionIndex}
              type="button"
              disabled={!part}
              onClick={() => part && props.onSelectPart(part.id)}
              className="-mx-2 flex h-8 items-center gap-2 rounded-md px-2 text-start text-[12.5px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <PartShapeIcon part={part} className="size-4" />
              <span className="min-w-0 flex-1 truncate">
                {props.isGridded ? `${sectionLetter(sectionIndex)} · ` : ''}
                {lightCaption(section)}
              </span>
              {part && (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground" dir="ltr">
                  {formatDimensionMm(part.rectMm.width)}×{formatDimensionMm(part.rectMm.height)}
                </span>
              )}
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
            </button>
          )
        })}
      </PropertyGroup>

    </div>
  )
}
