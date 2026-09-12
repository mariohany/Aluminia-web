import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassKind } from '@repo/types/windows'
import { ProfileType } from '@repo/types/lookups'
import type { ScopedRef } from '@repo/types/company-lookups'
import type { WindowLayout } from '@/lib/window-geometry'
import { dedupeIssues, type TranslatedIssue } from '@/lib/window-weight'
import { FieldLabel } from '@/components/workspace/field-label'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PanelHeader, Section, NumberField, IssueList, type WindowPartPanelGlassOption } from '@/components/workspace/window-part-panel'

export interface TransomPartPanelProps {
  /** For the Glass section's own computed-size caption and the
   * scroll-to/focus behaviour below — same shape `WindowPartPanel`
   * takes, deliberately, so both read the layout the identical way. */
  layout: WindowLayout
  selectedPartId: string | null
  issuesByPart: Map<string, TranslatedIssue[]>

  panelIndex: number
  panelCount: number
  onDeletePanel?: () => void
  deleteDisabledReason?: string

  name: string
  onNameChange: (value: string) => void
  nameError?: string
  quantity: number
  onQuantityChange: (value: number) => void
  quantityError?: string

  widthMm: number
  heightMm: number
  onWidthChange: (mm: number) => void
  onHeightChange: (mm: number) => void
  widthError?: string
  heightError?: string

  // Transom — the profile IS this panel's whole "frame", so a click on
  // its ring (kind 'frame' — a transom has no dedicated WindowPartKind
  // of its own) focuses this section, unlike a window's frame, which
  // has no matching section here at all (it's edited in the dialog's
  // own left-column tree instead — a tree a transom deliberately has
  // none of, docs/transom_tasks.md Step 5's own fix).
  transomProfile: string
  onTransomChange: (ref: ScopedRef) => void
  transomProfileError?: string
  preferredCatalogRef?: string | null
  preferredBrandRef?: string | null

  // Glass
  glassValue: string
  glassOptions: WindowPartPanelGlassOption[]
  onGlassChange: (kind: GlassKind, ref: ScopedRef) => void
  maxGlassAllowed: number | null
  /** §6: the same `computeSashWeightKg` a window's sash uses, sourced
   * from the transom's own profile — no catalogue-limit comparison
   * here (unlike the window Sash section's own weight line), since a
   * transom has no `maxSashWeight` ceiling to be over. */
  weightKg: number | null
}

/**
 * The transom counterpart to `WindowPartPanel` — deliberately a
 * SEPARATE, much smaller component rather than a branch bolted onto
 * that one, same posture `buildTransomLayout`/`AddTransomCard` already
 * chose over branching their own window counterparts (docs/
 * transom_planing.md §5: "a MUCH shorter form... omitting Sash,
 * Head/Bars, fly-screen/door, opening-type entirely — not rendered").
 * Shares `PanelHeader`/`Section`/`NumberField`/`IssueList` with
 * `window-part-panel.tsx` rather than re-implementing any of them.
 */
export function TransomPartPanel(props: TransomPartPanelProps) {
  const { t } = useTranslation('workspace')
  const transomRef = useRef<HTMLDivElement>(null)
  const glassRef = useRef<HTMLDivElement>(null)

  const selectedPart = props.layout.parts.find((p) => p.id === props.selectedPartId) ?? null

  useEffect(() => {
    if (!selectedPart) return
    const ref = selectedPart.kind === 'frame' ? transomRef : selectedPart.kind === 'glass' ? glassRef : null
    ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedPartId])

  const glassPart = props.layout.parts.find((p) => p.kind === 'glass')
  const glassIssues = dedupeIssues(
    props.layout.parts.filter((p) => p.kind === 'glass').flatMap((p) => props.issuesByPart.get(p.id) ?? []),
  )

  return (
    <div className="flex flex-col gap-4 text-sm">
      <PanelHeader
        panelIndex={props.panelIndex}
        panelCount={props.panelCount}
        onDeletePanel={props.onDeletePanel}
        deleteDisabledReason={props.deleteDisabledReason}
      />

      <div>
        <FieldLabel htmlFor="transom-name" required>
          {t('fields.windowName')}
        </FieldLabel>
        <Input
          id="transom-name"
          className="mt-1.5"
          aria-invalid={!!props.nameError}
          value={props.name}
          onChange={(e) => props.onNameChange(e.target.value)}
        />
        {props.nameError && <p className="mt-1 text-xs text-destructive">{props.nameError}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberField id="transom-width" label={t('fields.widthMm')} value={props.widthMm} onChange={props.onWidthChange} error={props.widthError} />
        <NumberField id="transom-height" label={t('fields.heightMm')} value={props.heightMm} onChange={props.onHeightChange} error={props.heightError} />
        <NumberField id="transom-quantity" label={t('fields.quantity')} value={props.quantity} onChange={props.onQuantityChange} error={props.quantityError} />
      </div>

      <Section innerRef={transomRef} title={t('windowDialog.design.sections.transom')} focused={selectedPart?.kind === 'frame'}>
        <div>
          <FieldLabel htmlFor="transom-profile" required>
            {t('fields.transomProfile')}
          </FieldLabel>
          <div className="mt-1.5 h-48 min-h-0 rounded-md border border-border">
            <ProfileTreePicker
              profileType={ProfileType.TRANSOM}
              value={props.transomProfile || null}
              onChange={props.onTransomChange}
              preferredCatalogRef={props.preferredCatalogRef}
              preferredBrandRef={props.preferredBrandRef}
            />
          </div>
          {props.transomProfileError && <p className="mt-1 text-xs text-destructive">{props.transomProfileError}</p>}
        </div>
        {props.weightKg !== null && (
          <p className="text-xs text-muted-foreground">
            {t('windowDialog.design.transomWeight', { weight: Math.round(props.weightKg * 10) / 10 })}
          </p>
        )}
      </Section>

      <Section innerRef={glassRef} title={t('windowDialog.design.sections.glass')} focused={selectedPart?.kind === 'glass'}>
        <div>
          <FieldLabel htmlFor="transom-glass" required>
            {t('fields.glass')}
          </FieldLabel>
          <Select
            value={props.glassValue}
            disabled={props.glassOptions.length === 0}
            onValueChange={(value) => {
              if (!value) return
              const [kind, ref] = value.split('|') as [GlassKind, ScopedRef]
              props.onGlassChange(kind, ref)
            }}
          >
            <SelectTrigger id="transom-glass" className="mt-1.5 w-full">
              <SelectValue
                placeholder={props.glassOptions.length === 0 ? t('fields.glassNeedsTransomProfile') : t('fields.glassPlaceholder')}
              />
            </SelectTrigger>
            <SelectContent>
              {props.glassOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.maxGlassAllowed !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('fields.glassDisclaimerTransom', { max: props.maxGlassAllowed })}
            </p>
          )}
        </div>
        {glassPart && (
          <p className="text-xs text-muted-foreground">
            {t('windowDialog.design.computedSize', {
              width: Math.round(glassPart.rectMm.width),
              height: Math.round(glassPart.rectMm.height),
            })}
          </p>
        )}
        <IssueList issues={glassIssues} />
      </Section>
    </div>
  )
}
