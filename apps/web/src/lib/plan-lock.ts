import { createContext, useContext } from 'react'
import type { PlanFeature } from '@repo/types/plans'

// Why "needs a paid plan" opens (docs/subscriptions_planing.md B12, B13).
export type PlanLockReason =
  | { kind: 'feature'; feature: PlanFeature }
  | { kind: 'limit'; what: 'clients' | 'projects' }
  | { kind: 'readOnly' }

export const PlanLockContext = createContext<(reason: PlanLockReason) => void>(() => {})

/** Opens the workspace's "needs a paid plan" dialog (PlanLockProvider). */
export function usePlanLock() {
  return useContext(PlanLockContext)
}

/** A dimmed rail item / Config card: present, but opens the lock dialog. */
export const DIMMED_CLASS = 'opacity-45'
