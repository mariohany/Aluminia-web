import type { PlanFeature } from '@repo/types/plans'
import { useCompanySubscriptionQuery } from '@/lib/company-queries'

/**
 * What the company's plan lets the workspace do (docs/subscriptions_planing.md
 * B12, B13). Mirrors the API's checks so the screens dim up front; the API
 * still refuses on its own. While the plan is loading everything is
 * allowed, so nothing flashes dimmed for a paid company.
 */
export function usePlanGate() {
  const { data } = useCompanySubscriptionQuery()
  const free = data?.state.kind === 'free'

  return {
    subscription: data,
    free,
    has: (feature: PlanFeature) => !data || data.features.includes(feature),
    /** Free's one client / one project: false once it has it. */
    canCreate: (what: 'clients' | 'projects') => {
      const max = data?.limits[what]
      return max == null || (data?.counts[what] ?? 0) < max
    },
    /** Only the picked project is editable on Free; with one or none there's nothing to pick. */
    isProjectEditable: (projectId: string | undefined) => {
      if (!data || !free || !projectId) return true
      if (data.freeProjectId === projectId) return true
      return data.freeProjectId === null && data.counts.projects <= 1
    },
  }
}
