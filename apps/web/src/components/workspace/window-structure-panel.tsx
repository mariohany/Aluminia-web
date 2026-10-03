import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowLeft, ChevronDown, XCircle } from 'lucide-react'
import { SectionKind } from '@repo/types/windows'
import type { WindowPanelInput } from '@repo/types/windows'
import type { TranslatedIssue } from '@/lib/window-weight'
import { formatDimensionMm, sectionLetter, type WindowPart } from '@/lib/window-geometry'
import { Button } from '@/components/ui/button'
import { NumberField } from '@/components/workspace/window-part-panel'
import { cn } from '@/lib/utils'

/**
 * The window editor's left column (docs/window_editor_redesign_planing.md
 * §2): back + project/window name + quantity on top, the assembly's
 * panels and their sections as a tree, the total glass area underneath.
 * The tree is a second way to select what the drawing already selects —
 * a panel row picks that panel's frame, a section row picks that
 * section's glass, both through the editor's own `onSelectPart`, so the
 * options column and the drawing's highlight follow exactly as if the
 * part had been clicked on the drawing.
 */
export function WindowStructurePanel({
  projectName,
  title,
  onBack,
  quantity,
  onQuantityChange,
  quantityError,
  panels,
  parts,
  outerMm,
  issuesByPart,
  activePanelIndex,
  activeSectionIndex,
  onSelectPart,
}: {
  projectName?: string
  title: string
  onBack: () => void
  quantity: number
  onQuantityChange: (value: number) => void
  quantityError?: string
  panels: WindowPanelInput[]
  parts: WindowPart[]
  outerMm: { width: number; height: number }
  issuesByPart: Map<string, TranslatedIssue[]>
  activePanelIndex: number
  activeSectionIndex: number
  onSelectPart: (partId: string) => void
}) {
  const { t } = useTranslation('workspace')

  // Worst issue per panel, from the same per-part map the drawing and
  // the issues panel read.
  const panelSeverity = (panelIndex: number): TranslatedIssue['severity'] | null => {
    let worst: TranslatedIssue['severity'] | null = null
    for (const [partId, issues] of issuesByPart) {
      if (!partId.startsWith(`p${panelIndex}:`)) continue
      if (issues.some((i) => i.severity === 'error')) return 'error'
      if (issues.length > 0) worst = 'warning'
    }
    return worst
  }

  // Rect area of every glass light, so an arched head counts its bounding
  // box — an indicative figure, same as the drawing's own sizes.
  const glassAreaM2 = parts
    .filter((p) => p.kind === 'glass')
    .reduce((sum, p) => sum + (p.rectMm.width * p.rectMm.height) / 1_000_000, 0)

  const sectionPartId = (panelIndex: number, sectionIndex: number): string | null =>
    parts.find((p) => p.panelIndex === panelIndex && p.sectionIndex === sectionIndex && p.kind === 'glass')?.id ??
    parts.find((p) => p.panelIndex === panelIndex && p.sectionIndex === sectionIndex)?.id ??
    null

  const sectionCaption = (section: WindowPanelInput['sections'][number]): string => {
    if (section.kind === SectionKind.FIXED) return t('windowDialog.design.section.kind.fixed')
    if (section.openingType) return t(`fields.openingTypeLabels.${section.openingType}`)
    return t('windowDialog.design.section.kind.opening')
  }

  // ↑/↓ between rows, same as the profile tree's own rows.
  const onTreeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-structure-row]:not(:disabled)'))
    const index = rows.indexOf(document.activeElement as HTMLElement)
    if (index === -1) return
    event.preventDefault()
    rows[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
  }

  const rowClass = (active: boolean, indent: number) =>
    cn(
      'flex h-8 w-full min-w-0 items-center gap-2 rounded-md pe-2 text-start text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
      indent === 1 ? 'ps-5' : 'ps-9',
      active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
    )

  return (
    <aside aria-label={t('windowDialog.design.structure.title')} className="flex min-h-0 min-w-0 flex-col border-e border-border bg-card">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" aria-label={t('actions.back')} onClick={onBack}>
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
          <div className="flex min-w-0 flex-col leading-tight">
            {projectName && <span className="truncate text-[11px] text-muted-foreground">{projectName}</span>}
            <h1 className="truncate font-heading text-sm font-semibold">{title}</h1>
          </div>
        </div>
        <NumberField
          id="window-quantity"
          label={t('fields.quantity')}
          value={quantity}
          onChange={onQuantityChange}
          error={quantityError}
        />
      </div>

      <nav
        aria-label={t('windowDialog.design.structure.title')}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
        onKeyDown={onTreeKeyDown}
      >
        <span className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {t('windowDialog.design.structure.title')}
        </span>
        <div className="flex h-8 items-center gap-2 px-2 text-[13px] font-medium">
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{t('windowDialog.design.structure.assembly')}</span>
          <span className="ms-auto font-mono text-[11px] text-muted-foreground" dir="ltr">
            {formatDimensionMm(outerMm.width)}×{formatDimensionMm(outerMm.height)}
          </span>
        </div>
        {panels.map((panel, panelIndex) => {
          const gridded = panel.columnWidths.length > 1 || panel.rowHeights.length > 1
          const severity = panelSeverity(panelIndex)
          const panelActive = activePanelIndex === panelIndex
          return (
            <div key={panelIndex} className="flex flex-col gap-0.5">
              <button
                type="button"
                aria-current={panelActive && !gridded ? 'true' : undefined}
                data-structure-row
                onClick={() => onSelectPart(`p${panelIndex}:frame`)}
                className={rowClass(panelActive && !gridded, 1)}
              >
                <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground', !gridded && 'invisible')} aria-hidden="true" />
                <span className={cn('truncate', panelActive && 'font-medium')}>
                  {t('windowDialog.design.structure.panel', { index: panelIndex + 1 })}
                </span>
                {severity === 'error' ? (
                  <XCircle className="ms-auto size-3.5 shrink-0 text-destructive" aria-label={t('windowDialog.design.structure.hasErrors')} />
                ) : severity === 'warning' ? (
                  <AlertTriangle
                    className="ms-auto size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                    aria-label={t('windowDialog.design.structure.hasWarnings')}
                  />
                ) : (
                  <span className="ms-auto shrink-0 font-mono text-[11px] text-muted-foreground" dir="ltr">
                    {formatDimensionMm(panel.widthMm)}×{formatDimensionMm(panel.heightMm)}
                  </span>
                )}
              </button>
              {gridded &&
                panel.sections.map((section) => {
                  const sectionIndex = section.row * panel.columnWidths.length + section.col
                  const partId = sectionPartId(panelIndex, sectionIndex)
                  const active = panelActive && activeSectionIndex === sectionIndex
                  return (
                    <button
                      key={sectionIndex}
                      type="button"
                      disabled={!partId}
                      aria-current={active ? 'true' : undefined}
                      data-structure-row
                      onClick={() => partId && onSelectPart(partId)}
                      className={rowClass(active, 2)}
                    >
                      <span className="shrink-0">
                        {t('windowDialog.design.sections.section')} {sectionLetter(sectionIndex)}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">· {sectionCaption(section)}</span>
                    </button>
                  )
                })}
            </div>
          )
        })}
      </nav>

      <div className="flex shrink-0 justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span>{t('windowDialog.design.structure.glassArea')}</span>
        <span className="font-mono text-foreground" dir="ltr">
          {t('windowDialog.design.structure.squareMetres', { value: glassAreaM2.toFixed(2) })}
        </span>
      </div>
    </aside>
  )
}
