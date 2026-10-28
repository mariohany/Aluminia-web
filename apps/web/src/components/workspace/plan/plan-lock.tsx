import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { PlanLockContext, type PlanLockReason } from '@/lib/plan-lock'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * The one "needs a paid plan" dialog of the workspace (B12): a dimmed
 * rail item, Config card or create button opens it instead of going on.
 */
export function PlanLockProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('workspace')
  const [reason, setReason] = useState<PlanLockReason | null>(null)
  const show = useCallback((next: PlanLockReason) => setReason(next), [])

  const title =
    reason?.kind === 'feature'
      ? t('plan.locked.featureTitle', { feature: t(`plan.features.${reason.feature}`) })
      : reason?.kind === 'limit'
        ? t(`plan.locked.limitTitle.${reason.what}`)
        : reason
          ? t('plan.readOnly.title')
          : ''
  const body = reason?.kind === 'readOnly' ? t('plan.readOnly.body') : t('plan.locked.body')

  return (
    <PlanLockContext.Provider value={show}>
      {children}
      <Dialog open={reason !== null} onOpenChange={(open) => !open && setReason(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Lock className="size-5" aria-hidden="true" />
            </span>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setReason(null)}>{t('plan.locked.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlanLockContext.Provider>
  )
}

