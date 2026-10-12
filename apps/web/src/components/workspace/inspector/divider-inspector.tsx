import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import { ProfileType } from '@repo/types/lookups'
import { Button } from '@/components/ui/button'
import { PartShapeIcon } from '@/components/workspace/part-shape-icon'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'
import { InspectorChip, InspectorHeader, InspectorIssueChip } from '@/components/workspace/inspector/inspector-header'
import { PropertyGroup } from '@/components/workspace/inspector/property-group'
import { PropertyRow, PropertyText } from '@/components/workspace/inspector/property-row'
import { PropertyNumber } from '@/components/workspace/inspector/property-controls'
import { PickerPopover } from '@/components/workspace/inspector/picker-popover'
import type { SelectedDividerProps, WindowPartPanelProps } from '@/components/workspace/window-part-panel'

/**
 * The Divider level of the inspector — docs/inspector_redesign_planing.md
 * §9: a selected mullion/transom's own profile (the panel default unless
 * overridden), its position with 1 mm nudges, its length, its bend (arch
 * dividers only) and what each end stands on. Delete is in the ⋯ menu
 * and still goes through the delete-divider dialog.
 */
export function DividerInspector({ props, divider }: { props: WindowPartPanelProps; divider: SelectedDividerProps }) {
  const { t } = useTranslation('workspace')
  const part = props.layout.parts.find((p) => p.id === props.selectedPartId)
  const issues = part ? (props.issuesByPart.get(part.id) ?? []) : []
  const panelLabel = t('windowDialog.design.structure.panel', { index: props.panelIndex + 1 })
  const bent = divider.bend?.radiusMm != null
  const override = divider.profile.override
  const position = divider.position

  return (
    <div className="flex flex-col">
      <InspectorHeader
        crumb={`${panelLabel} › ${divider.label}`}
        title={divider.label}
        thumb={<PartShapeIcon part={part} className="size-10" />}
        chips={
          <>
            <InspectorChip>{bent ? t('windowDialog.inspector.chips.bent') : t('windowDialog.design.dividerTool.straight')}</InspectorChip>
            <InspectorIssueChip issues={issues} />
          </>
        }
        actions={[{ label: t('windowDialog.design.removeDivider'), onSelect: divider.onRemove, destructive: true }]}
      />

      <PropertyGroup id="divider.profile" title={t('windowDialog.inspector.groups.profile')} first>
        <PropertyRow
          label={t('windowDialog.inspector.rows.profile')}
          htmlFor="divider-profile"
          error={divider.profileNumber ? undefined : t('fields.dividerProfileRequired')}
        >
          <PickerPopover
            id="divider-profile"
            contentClassName="flex h-[26rem] w-[22rem] flex-col gap-2"
            button={{
              value: divider.profileNumber ?? '',
              placeholder: t('fields.dividerProfile'),
              sub: divider.profileNumber && !override ? t('windowDialog.inspector.panelDefault') : undefined,
            }}
          >
            {(close) => (
              <>
                <div className="min-h-0 flex-1">
                  <ProfileTreePicker
                    profileType={ProfileType.TRANSOM}
                    value={override ?? divider.profile.panelDefault}
                    onChange={(ref) => {
                      divider.profile.onChange(ref)
                      close()
                    }}
                    catalogRef={props.frameCatalogRef}
                  />
                </div>
                {override && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      divider.profile.onChange(null)
                      close()
                    }}
                  >
                    {t('windowDialog.design.dividerInspector.useDefault')}
                  </Button>
                )}
              </>
            )}
          </PickerPopover>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup id="divider.position" title={t('windowDialog.inspector.groups.position')}>
        {position && (
          <PropertyRow
            label={t(position.axis === 'v' ? 'windowDialog.inspector.rows.fromLeft' : 'windowDialog.inspector.rows.fromSill')}
            htmlFor="divider-position"
          >
            <span className="flex w-full items-center gap-1">
              <PropertyNumber id="divider-position" value={Math.round(position.valueMm * 10) / 10} onCommit={position.onChange} />
              {/* A mullion moves right with +, a transom up (Q15). */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7.5 shrink-0"
                aria-label={t('windowDialog.inspector.nudge', { mm: -1 })}
                onClick={() => position.onChange(position.valueMm - 1)}
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7.5 shrink-0"
                aria-label={t('windowDialog.inspector.nudge', { mm: 1 })}
                onClick={() => position.onChange(position.valueMm + 1)}
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Button>
            </span>
          </PropertyRow>
        )}
        <PropertyRow label={t('windowDialog.inspector.rows.length')}>
          <PropertyText>{Math.round(divider.lengthMm)} mm</PropertyText>
        </PropertyRow>
      </PropertyGroup>

      {divider.bend && (
        <PropertyGroup id="divider.bend" title={t('windowDialog.inspector.groups.bend')}>
          <PropertyRow
            label={t('windowDialog.inspector.rows.radius')}
            htmlFor="divider-radius"
            hint={t('windowDialog.design.dividerTool.radiusHint', { min: divider.bend.minMm })}
          >
            <PropertyNumber
              id="divider-radius"
              value={divider.bend.radiusMm}
              min={divider.bend.minMm}
              placeholder={t('windowDialog.design.dividerTool.straight')}
              onCommit={divider.bend.onChange}
              onClear={() => divider.bend?.onChange(null)}
            />
          </PropertyRow>
        </PropertyGroup>
      )}

      {divider.ends.length > 0 && (
        <PropertyGroup id="divider.ends" title={t('windowDialog.inspector.groups.ends')}>
          {divider.ends.map((line, i) => (
            <p key={i} className="py-1 text-[12.5px]" dir="auto">
              {line}
            </p>
          ))}
        </PropertyGroup>
      )}
    </div>
  )
}
