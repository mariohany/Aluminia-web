import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** One label · fields row of a Config section card (board D). */
export function ConfigRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-border py-4 md:grid-cols-[260px_minmax(0,1fr)] md:gap-7">
      <div className="flex flex-col gap-1">
        <span className="text-[13.5px] font-semibold text-foreground">{title}</span>
        <span className="text-[12.5px] leading-snug text-muted-foreground">{hint}</span>
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2.5">{children}</div>
    </div>
  )
}

export function ConfigGrid2({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}

/** The Save / Discard bar at the bottom of a Config section card. Save is
 * the form's submit button. */
export function ConfigSaveBar({
  dirty,
  busy,
  saveDisabled = false,
  onDiscard,
}: {
  dirty: boolean
  busy: boolean
  saveDisabled?: boolean
  onDiscard: () => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
      {dirty ? (
        <span className="inline-flex items-center gap-2 text-[12.5px] text-amber-700 dark:text-amber-400">
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {t('config.unsaved')}
        </span>
      ) : (
        <span className="text-[12.5px] text-muted-foreground">{t('config.allSaved')}</span>
      )}
      <span className="flex-1" />
      <Button type="button" variant="outline" disabled={!dirty || busy} onClick={onDiscard}>
        {t('actions.discard')}
      </Button>
      <Button type="submit" disabled={!dirty || busy || saveDisabled}>
        <Check className="size-4" aria-hidden="true" />
        {t('actions.save')}
      </Button>
    </div>
  )
}
