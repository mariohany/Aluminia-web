import { useTranslation } from 'react-i18next'
import { RectangleHorizontal, SeparatorHorizontal } from 'lucide-react'
import { PanelType } from '@repo/types/windows'
import type { PanelSide } from '@/lib/window-geometry'
import { useAddPanelCardPosition } from '@/lib/add-panel-popover'

/**
 * The first thing a "+" click opens — Window or Transom — before
 * either size card (docs/transom_planing.md §4). A plain rect icon vs.
 * a slim divider bar is legible at a glance without a label, but both
 * get one anyway: this is the one popover in the flow a first-time user
 * has never seen before, so it shouldn't rely on icon literacy alone.
 */
export function AddPanelTypeStep({
  anchor,
  onCancel,
  onChoose,
}: {
  anchor: { side: PanelSide; at: { left: number; top: number } } | null
  onCancel: () => void
  onChoose: (type: PanelType) => void
}) {
  const { t } = useTranslation('workspace')
  const { cardRef, style } = useAddPanelCardPosition(anchor)

  if (!anchor) return null

  return (
    <div
      ref={cardRef}
      dir={document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'}
      role="dialog"
      aria-label={t('windowDialog.design.addPanel.typeStep.title')}
      className="absolute z-20 w-52 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <p className="text-sm font-medium">{t('windowDialog.design.addPanel.typeStep.title')}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          autoFocus
          onClick={() => onChoose(PanelType.WINDOW)}
          className="flex flex-col items-center gap-1.5 rounded-md border border-border py-3 text-xs hover:border-primary hover:bg-accent"
        >
          <RectangleHorizontal className="size-6" aria-hidden="true" />
          {t('fields.panelTypeLabels.window')}
        </button>
        <button
          type="button"
          onClick={() => onChoose(PanelType.TRANSOM)}
          className="flex flex-col items-center gap-1.5 rounded-md border border-border py-3 text-xs hover:border-primary hover:bg-accent"
        >
          <SeparatorHorizontal className="size-6" aria-hidden="true" />
          {t('fields.panelTypeLabels.transom')}
        </button>
      </div>
    </div>
  )
}
