import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PointMm } from '@/lib/arch-geometry'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

// The divider delete confirmation (docs/free_dividers_planing.md §7,
// Q11 + Q18). A divider can't go alone: one side's light(s) go with it
// and the other side takes the space, keeping its own settings. When
// other dividers stand on it, they are either deleted too or extended to
// the next member.

export interface DeleteDividerRequest {
  panelIndex: number
  ids: string[]
  /** Already-translated names of `ids`, for the title. */
  names: string[]
  /** The two sides to choose from — `null` when the choice is already
   * made (a light was selected with the divider) or there are several
   * dividers. */
  sides: { left: string[]; right: string[] } | null
  /** The lights kept when `sides` is null. */
  keep: string[]
  /** Already-translated names of the dividers standing on `ids`. */
  dependents: string[]
  /** The panel's lights and size, for the side thumbnails. */
  lights: { key: string; polygon: PointMm[] }[]
  size: { width: number; height: number }
}

export function DeleteDividerDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: DeleteDividerRequest | null
  onConfirm: (keep: string[], mode: 'delete' | 'extend') => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && onCancel()}>
      {/* Keyed so each request starts with nothing picked. */}
      {request && <DialogBody key={request.ids.join(',')} request={request} onConfirm={onConfirm} />}
    </AlertDialog>
  )
}

function DialogBody({ request, onConfirm }: { request: DeleteDividerRequest; onConfirm: (keep: string[], mode: 'delete' | 'extend') => void }) {
  const { t } = useTranslation('workspace')
  const [goes, setGoes] = useState<'left' | 'right' | null>(null)
  const [mode, setMode] = useState<'delete' | 'extend'>('extend')
  const ready = !request.sides || goes !== null
  const keep = request.sides ? (goes === 'left' ? request.sides.right : goes === 'right' ? request.sides.left : []) : request.keep

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('windowDialog.design.deleteDivider.title', { names: request.names.join(', ') })}</AlertDialogTitle>
        <AlertDialogDescription>
          {request.sides
            ? t('windowDialog.design.deleteDivider.notAlone')
            : request.dependents.length > 0
              ? t('windowDialog.design.deleteDivider.dependentsOnly')
              : t('windowDialog.design.deleteDivider.merge')}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {request.sides && (
        <div className="grid grid-cols-2 gap-3">
          {(['left', 'right'] as const).map((side, i) => (
            <button
              key={side}
              type="button"
              aria-pressed={goes === side}
              onClick={() => setGoes(side)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border p-3 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                goes === side ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border hover:bg-accent',
              )}
            >
              <SideThumbnail request={request} highlight={request.sides![side]} />
              {t('windowDialog.design.deleteDivider.side', { letter: i === 0 ? 'A' : 'B' })}
            </button>
          ))}
        </div>
      )}

      {request.dependents.length > 0 && (
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 text-xs text-muted-foreground">
            {t('windowDialog.design.deleteDivider.dependents', { names: request.dependents.join(', ') })}
          </legend>
          {(['extend', 'delete'] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name="dependents" checked={mode === m} onChange={() => setMode(m)} />
              {t(m === 'extend' ? 'windowDialog.design.deleteDivider.extendRest' : 'windowDialog.design.deleteDivider.deleteAll')}
            </label>
          ))}
        </fieldset>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={!ready} onClick={() => onConfirm(keep, mode)}>
          {t('windowDialog.design.deleteDivider.confirm')}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

/** The panel's lights drawn small, the side that goes filled red. A
 * drawing, so it never mirrors (§10). */
function SideThumbnail({ request, highlight }: { request: DeleteDividerRequest; highlight: string[] }) {
  const { width, height } = request.size
  const pad = Math.max(width, height) * 0.04
  const stroke = Math.max(width, height) * 0.01
  return (
    <svg viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`} className="h-24 w-full" aria-hidden="true">
      {request.lights.map((l) => (
        <polygon
          key={l.key}
          points={l.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={highlight.includes(l.key) ? 'var(--destructive)' : 'var(--muted)'}
          fillOpacity={highlight.includes(l.key) ? 0.45 : 1}
          stroke="var(--muted-foreground)"
          strokeWidth={stroke}
        />
      ))}
    </svg>
  )
}
