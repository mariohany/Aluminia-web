import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import type { PlanFeature } from '@repo/types/plans'
import { usePlanGate } from '@/lib/plan-gate'

/**
 * A page behind a plan feature, reached by its URL on Free (B12): the rail
 * and Config dim the way in, this covers a bookmark or a typed address.
 */
export function FeatureGate({ feature, children }: { feature: PlanFeature; children: React.ReactNode }) {
  const { t } = useTranslation('workspace')
  const planGate = usePlanGate()
  if (planGate.has(feature)) return children
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold text-foreground">
          {t('plan.locked.featureTitle', { feature: t(`plan.features.${feature}`) })}
        </p>
        <p className="text-sm text-muted-foreground">{t('plan.locked.body')}</p>
      </div>
    </div>
  )
}
