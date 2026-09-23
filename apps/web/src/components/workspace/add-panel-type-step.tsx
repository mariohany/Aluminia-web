import { useTranslation } from 'react-i18next'
import { RectangleHorizontal, SeparatorHorizontal } from 'lucide-react'
import type { PanelSide } from '@/lib/window-geometry'
import { useAddPanelCardPosition } from '@/lib/add-panel-popover'
import { cn } from '@/lib/utils'

/** What a "+" click can add — a new coupled frame, or a divider that
 * grows the SAME panel (docs/sections_planing.md decision 2). */
export type AddChoice = 'window' | 'divider'

/**
 * The first thing a "+" click opens — Window or Mullion/Transom — before
 * either size card. A plain rect icon vs. a slim divider bar is legible
 * at a glance without a label, but both get one anyway: this is the one
 * popover in the flow a first-time user has never seen before, so it
 * shouldn't rely on icon literacy alone.
 *
 * The second choice's word comes from the side it opened on — left/right
 * reads "Mullion", top/bottom reads "Transom" (the divider's own
 * orientation, decided the instant the "+" was clicked) — and it's only
 * offered at all when exactly one panel is selected: growing "the same
 * panel" has no meaning for a multi-panel selection, which can only ever
 * add a new coupled Window.
 */
export function AddPanelTypeStep({
  anchor,
  allowDivider,
  onCancel,
  onChoose,
}: {
  anchor: { side: PanelSide; at: { left: number; top: number } } | null
  allowDivider: boolean
  onCancel: () => void
  onChoose: (choice: AddChoice) => void
}) {
  const { t } = useTranslation('workspace')
  const { cardRef, style } = useAddPanelCardPosition(anchor, undefined, onCancel)

  if (!anchor) return null

  const dividerWord = anchor.side === 'left' || anchor.side === 'right' ? 'mullion' : 'transom'

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
          onClick={() => onChoose('window')}
          className="flex flex-col items-center gap-1.5 rounded-md border border-border py-3 text-xs hover:border-primary hover:bg-accent"
        >
          <RectangleHorizontal className="size-6" aria-hidden="true" />
          {t('fields.panelTypeLabels.window')}
        </button>
        {allowDivider && (
          <button
            type="button"
            onClick={() => onChoose('divider')}
            className="flex flex-col items-center gap-1.5 rounded-md border border-border py-3 text-xs hover:border-primary hover:bg-accent"
          >
            {/* `SeparatorHorizontal` is drawn as a horizontal bar — right
                for a transom (top/bottom), but a mullion (left/right) is
                the same bar turned on its side (Mario, 2026-09-15: "the
                image need to be rotated 90 degree"). */}
            <SeparatorHorizontal className={cn('size-6', dividerWord === 'mullion' && 'rotate-90')} aria-hidden="true" />
            {t(`windowDialog.design.parts.${dividerWord}`)}
          </button>
        )}
      </div>
    </div>
  )
}
