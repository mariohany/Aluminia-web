import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassKind, HingedOpeningType } from '@repo/types/windows'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import type { WindowLayout, WindowPartKind } from '@/lib/window-geometry'
import type { TranslatedIssue } from '@/lib/window-weight'
import type { MergedSystemProfileSummary } from '@/lib/lookup-merge'
import { cn } from '@/lib/utils'
import { FieldLabel } from '@/components/workspace/field-label'
import { OpeningTypeIcon } from '@/components/icons/opening-type-icon'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Radix rejects an empty-string item value — same sentinel window-dialog.tsx uses.
const NONE = '__none'

// Grid order — one row of the four "primary" hinge/pivot ways a single
// leaf opens, then their mirrored/tilt-turn pairs, then the two-leaf and
// fixed-mullion families last (the less common picks).
const OPENING_TYPE_OPTIONS: HingedOpeningType[] = [
  HingedOpeningType.FIXED_CLOSED,
  HingedOpeningType.TOP_HUNG,
  HingedOpeningType.SIDE_HUNG_LEFT,
  HingedOpeningType.SIDE_HUNG_RIGHT,
  HingedOpeningType.TILT_TURN_LEFT,
  HingedOpeningType.TILT_TURN_RIGHT,
  HingedOpeningType.PIVOT_BOTTOM,
  HingedOpeningType.PIVOT_SIDE,
  HingedOpeningType.SINGLE_DOOR_HINGE_LEFT,
  HingedOpeningType.SINGLE_DOOR_HINGE_RIGHT,
  HingedOpeningType.DOUBLE_DOOR_FRENCH_A,
  HingedOpeningType.DOUBLE_DOOR_FRENCH_B,
  HingedOpeningType.DOUBLE_DOOR_HANDLES_A,
  HingedOpeningType.DOUBLE_DOOR_HANDLES_B,
  HingedOpeningType.FIXED_VERTICAL_MULLION,
  HingedOpeningType.FIXED_HORIZONTAL_MULLION,
]

export interface WindowPartPanelColorOption {
  value: string
  label: string
  hex: string
}

export interface WindowPartPanelGlassOption {
  value: string
  label: string
}

export interface WindowPartPanelProps {
  /** The current drawing layout — Sash/Glass read their own part's
   * computed size from here directly, independent of what's selected,
   * since every section renders at once. */
  layout: WindowLayout
  /** Drives which section scrolls into view + gets the focus ring
   * (frame's own focus ring lives on window-dialog.tsx's tree column
   * instead — the tree isn't part of this panel any more). */
  selectedPartId: string | null
  /** Full map from `collectWindowIssues()`, keyed by part id — each
   * section filters out its own kind's issues. */
  issuesByPart: Map<string, TranslatedIssue[]>

  name: string
  onNameChange: (value: string) => void
  /** Already-translated "required" messages — undefined/blank means no
   * error is shown. window-dialog.tsx only ever passes these once
   * `showValidation` is true (edit mode, or after a first submit
   * attempt in create mode) — see its own comment for why. */
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

  hasFlyScreen: boolean
  flyScreenAllowed: boolean
  onFlyScreenChange: (value: boolean) => void
  showDoor: boolean
  isDoor: boolean
  onDoorChange: (value: boolean) => void

  interiorColor: string | null
  exteriorColor: string | null
  onInteriorColorChange: (value: string | null) => void
  onExteriorColorChange: (value: string | null) => void
  colorOptions: WindowPartPanelColorOption[]

  // Type — the opening-type icon grid, hinged windows only (sliding
  // gets its own icon set later, not this one). window-dialog.tsx
  // already clears the value when the frame stops being hinged, so this
  // panel only has to decide whether to show the grid at all.
  showOpeningTypes: boolean
  openingType: HingedOpeningType | null
  onOpeningTypeChange: (value: HingedOpeningType | null) => void

  // Sash
  sashProfile: string
  sashOptions: MergedSystemProfileSummary[]
  onSashChange: (ref: ScopedRef) => void
  sashWeightKg: number | null
  maxSashWeight: number | null

  // Glass
  glassValue: string
  glassOptions: WindowPartPanelGlassOption[]
  onGlassChange: (kind: GlassKind, ref: ScopedRef) => void
  maxGlassAllowed: number | null
  sashMaxGlassThickness: number | null

  // Belongs to no drawn part — same posture as name/size/quantity above.
  location: string | null
  onLocationChange: (value: string | null) => void
  notes: string | null
  onNotesChange: (value: string | null) => void
}

/**
 * The dialog's fixed-width options column. Name, size/quantity, the
 * fly-screen/door checkboxes, both colours, and location/notes sit at
 * the top as plain fields (they belong to the whole window, not one
 * drawn part); Sash and Glass are their own scroll-targeted sections
 * below. Clicking a part on the drawing scrolls its section into view
 * and gives it a focus ring.
 */
export function WindowPartPanel(props: WindowPartPanelProps) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')

  const sashRef = useRef<HTMLDivElement>(null)
  const glassRef = useRef<HTMLDivElement>(null)
  const flyScreenRef = useRef<HTMLDivElement>(null)
  const sectionRefs: Partial<Record<WindowPartKind, React.RefObject<HTMLDivElement | null>>> = {
    sash: sashRef,
    glass: glassRef,
    flyScreen: flyScreenRef,
  }

  const selectedPart = props.layout.parts.find((p) => p.id === props.selectedPartId) ?? null

  useEffect(() => {
    if (!selectedPart) return
    sectionRefs[selectedPart.kind]?.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // Only the identity of the selection should re-trigger a scroll —
    // not every render, and not a re-render of the layout itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedPartId])

  const sashPart = props.layout.parts.find((p) => p.kind === 'sash')
  const glassPart = props.layout.parts.find((p) => p.kind === 'glass')

  const sashIssues = dedupeIssues(
    props.layout.parts.filter((p) => p.kind === 'sash').flatMap((p) => props.issuesByPart.get(p.id) ?? []),
  )
  const glassIssues = dedupeIssues(
    props.layout.parts.filter((p) => p.kind === 'glass').flatMap((p) => props.issuesByPart.get(p.id) ?? []),
  )
  const flyScreenPart = props.layout.parts.find((p) => p.kind === 'flyScreen')
  const flyScreenIssues = flyScreenPart ? (props.issuesByPart.get(flyScreenPart.id) ?? []) : []

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <FieldLabel htmlFor="panel-name" required>
          {t('fields.windowName')}
        </FieldLabel>
        <Input
          id="panel-name"
          className="mt-1.5"
          aria-invalid={!!props.nameError}
          value={props.name}
          onChange={(e) => props.onNameChange(e.target.value)}
        />
        {props.nameError && <p className="mt-1 text-xs text-destructive">{props.nameError}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberField
          id="panel-width"
          label={t('fields.widthMm')}
          value={props.widthMm}
          onChange={props.onWidthChange}
          error={props.widthError}
        />
        <NumberField
          id="panel-height"
          label={t('fields.heightMm')}
          value={props.heightMm}
          onChange={props.onHeightChange}
          error={props.heightError}
        />
        <NumberField
          id="panel-quantity"
          label={t('fields.quantity')}
          value={props.quantity}
          onChange={props.onQuantityChange}
          error={props.quantityError}
        />
      </div>

      <div>
        <div ref={flyScreenRef} className="flex flex-wrap gap-2">
          <CheckboxChip
            checked={props.hasFlyScreen}
            disabled={!props.flyScreenAllowed}
            onCheckedChange={props.onFlyScreenChange}
            label={t('fields.hasFlyScreen')}
            focused={selectedPart?.kind === 'flyScreen'}
            title={!props.flyScreenAllowed ? t('fields.flyScreenDisabledHint') : undefined}
          />
          {props.showDoor && (
            <CheckboxChip checked={props.isDoor} onCheckedChange={props.onDoorChange} label={t('fields.isDoor')} />
          )}
        </div>
        <IssueList issues={flyScreenIssues} />
      </div>

      {props.showOpeningTypes && (
        <div>
          <FieldLabel htmlFor="panel-opening-type">{t('fields.openingTypeSection')}</FieldLabel>
          <div id="panel-opening-type" role="group" aria-label={t('fields.openingTypeSection')} className="mt-1.5 grid grid-cols-8 gap-1">
            {OPENING_TYPE_OPTIONS.map((type) => {
              const selected = props.openingType === type
              return (
                <button
                  key={type}
                  type="button"
                  title={t(`fields.openingTypeLabels.${type}`)}
                  aria-label={t(`fields.openingTypeLabels.${type}`)}
                  aria-pressed={selected}
                  onClick={() => props.onOpeningTypeChange(selected ? null : type)}
                  className={cn(
                    'flex items-center justify-center rounded-md border p-1 transition-colors',
                    selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground',
                  )}
                >
                  <OpeningTypeIcon type={type} className="size-full" />
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <ColorField
          id="panel-interior-color"
          label={t('fields.interiorColor')}
          placeholder={t('fields.colorPlaceholder')}
          value={props.interiorColor}
          options={props.colorOptions}
          onChange={props.onInteriorColorChange}
        />
        <ColorField
          id="panel-exterior-color"
          label={t('fields.exteriorColor')}
          placeholder={t('fields.colorPlaceholder')}
          value={props.exteriorColor}
          options={props.colorOptions}
          onChange={props.onExteriorColorChange}
        />
      </div>

      <Section innerRef={sashRef} title={t('windowDialog.design.sections.sash')} focused={selectedPart?.kind === 'sash'}>
        <div>
          <FieldLabel htmlFor="panel-sash" required>
            {t('fields.sashProfile')}
          </FieldLabel>
          <Select
            value={props.sashProfile || NONE}
            disabled={props.sashOptions.length === 0}
            onValueChange={(value) => {
              if (!value) return
              props.onSashChange(value as ScopedRef)
            }}
          >
            <SelectTrigger id="panel-sash" className="mt-1.5 w-full">
              <SelectValue
                placeholder={props.sashOptions.length === 0 ? t('fields.sashProfileNeedsFrame') : t('fields.sashProfilePlaceholder')}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} disabled>
                {t('fields.sashProfilePlaceholder')}
              </SelectItem>
              {props.sashOptions.map((opt) => (
                <SelectItem key={opt.id} value={formatScopedRef(opt.scope, opt.id)}>
                  {opt.profileNo} — {tLookups('fields.maxGlassThickness')}: {opt.maxGlassThickness}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sashPart && (
          <p className="text-xs text-muted-foreground">
            {t('windowDialog.design.computedSize', {
              width: Math.round(sashPart.rectMm.width),
              height: Math.round(sashPart.rectMm.height),
            })}
          </p>
        )}
        {props.sashWeightKg !== null && (
          <p
            className={cn(
              'text-xs',
              props.maxSashWeight !== null && props.sashWeightKg > props.maxSashWeight
                ? 'font-medium text-amber-600 dark:text-amber-500'
                : 'text-muted-foreground',
            )}
          >
            {t('windowDialog.design.sashWeight', {
              weight: Math.round(props.sashWeightKg * 10) / 10,
              max: props.maxSashWeight ?? '—',
            })}
          </p>
        )}
        {/* sashWeightExceeded is already shown above with its own
            computed-vs-allowed figures — don't repeat it as a plain
            issue line too. */}
        <IssueList issues={sashIssues.filter((i) => i.messageKey !== 'sashWeightExceeded')} />
      </Section>

      <Section innerRef={glassRef} title={t('windowDialog.design.sections.glass')} focused={selectedPart?.kind === 'glass'}>
        <div>
          <FieldLabel htmlFor="panel-glass" required>
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
            <SelectTrigger id="panel-glass" className="mt-1.5 w-full">
              <SelectValue
                placeholder={props.glassOptions.length === 0 ? t('fields.glassNeedsSash') : t('fields.glassPlaceholder')}
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
              {t('fields.glassDisclaimer', { max: props.maxGlassAllowed, sashMax: props.sashMaxGlassThickness })}
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

      <div>
        <FieldLabel htmlFor="panel-location" optional>
          {t('fields.location')}
        </FieldLabel>
        <Input
          id="panel-location"
          className="mt-1.5"
          value={props.location ?? ''}
          onChange={(e) => props.onLocationChange(blankToNull(e.target.value))}
        />
      </div>

      <div>
        <FieldLabel htmlFor="panel-notes" optional>
          {t('fields.notes')}
        </FieldLabel>
        <Textarea
          id="panel-notes"
          className="mt-1.5"
          rows={3}
          value={props.notes ?? ''}
          onChange={(e) => props.onNotesChange(blankToNull(e.target.value))}
        />
      </div>
    </div>
  )
}

// Same blank->null rule as apps/web/src/lib/form-fields.ts's
// `optionalTextField` (a register()-only helper this panel can't use,
// since every field here is controlled) — an empty box means "clear
// it" (null), not "leave alone" (undefined never applies to a
// controlled input's own onChange).
function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function Section({
  innerRef,
  title,
  focused,
  children,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>
  title: string
  focused: boolean
  children: React.ReactNode
}) {
  return (
    <div
      ref={innerRef}
      className={cn(
        'flex scroll-my-2 flex-col gap-3 rounded-lg border p-3 transition-colors',
        focused ? 'border-primary bg-primary/5' : 'border-transparent',
      )}
    >
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </div>
  )
}

function CheckboxChip({
  checked,
  disabled,
  onCheckedChange,
  label,
  focused,
  title,
}: {
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  focused?: boolean
  /** Shown as a native hover tooltip — used for the fly-screen chip's
   * "this frame doesn't accept one" explanation, which used to sit
   * permanently under the checkboxes and now only appears on hover. */
  title?: string
}) {
  return (
    <label
      title={title}
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
        focused ? 'border-primary bg-primary/5' : 'border-border',
        disabled && 'opacity-50',
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onCheckedChange(!!next)} />
      {label}
    </label>
  )
}

function dedupeIssues(issues: TranslatedIssue[]): TranslatedIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    if (seen.has(issue.message)) return false
    seen.add(issue.message)
    return true
  })
}

function IssueList({ issues }: { issues: TranslatedIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue, i) => (
        <li
          key={i}
          className={cn(
            'text-xs',
            issue.severity === 'error' ? 'text-destructive' : 'font-medium text-amber-600 dark:text-amber-500',
          )}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string
  label: string
  value: number
  onChange: (mm: number) => void
  error?: string
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <Input
        id={id}
        className="mt-1.5"
        type="number"
        min={1}
        dir="ltr"
        aria-invalid={!!error}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ColorField({
  id,
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value: string | null
  options: WindowPartPanelColorOption[]
  onChange: (value: string | null) => void
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} optional>
        {label}
      </FieldLabel>
      <Select
        value={value ?? NONE}
        onValueChange={(next) => {
          if (!next) return
          onChange(next === NONE ? null : next)
        }}
      >
        <SelectTrigger id={id} className="mt-1.5 w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{placeholder}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-3 shrink-0 rounded-sm border border-border"
                  style={{ backgroundColor: opt.hex }}
                  aria-hidden="true"
                />
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
