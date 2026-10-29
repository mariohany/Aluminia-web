import type { PlanFeature, PlanKey } from '@repo/types/plans';
import type { SubscriptionState } from '@repo/types/subscriptions';

// The company's plan as SubscriptionGuard found it for this request
// (`request.subscription`). `features` is what the company may use now:
// none on Free, the plan's own on a paid plan or a trial.
export interface SubscriptionAccess {
  companyId: string;
  planKey: PlanKey;
  state: SubscriptionState;
  free: boolean;
  features: PlanFeature[];
  freeProjectId: string | null;
}

export const SUBSCRIPTION_ENDED_MESSAGE =
  "Your company's subscription has ended. Ask your company admin to renew it.";

export const PLAN_DEACTIVATED_MESSAGE =
  'Your company is on the Free plan, which has one user. Ask your company admin to upgrade.';
