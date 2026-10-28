import { SetMetadata } from '@nestjs/common';
import type { PlanFeature } from '@repo/types/plans';

export const REQUIRES_FEATURE_KEY = 'requiresFeature';

export interface RequiredFeature {
  feature: PlanFeature;
  // Only writes need the feature: the window editor reads company lookups
  // and project settings on every plan (docs/subscriptions_planing.md §4b).
  writesOnly: boolean;
}

/**
 * A route (or controller) needs a plan feature. SubscriptionGuard answers
 * 403 `feature_locked` when the company's plan doesn't have it.
 */
export const RequiresFeature = (
  feature: PlanFeature,
  options: { writesOnly?: boolean } = {},
) =>
  SetMetadata(REQUIRES_FEATURE_KEY, {
    feature,
    writesOnly: options.writesOnly ?? false,
  } satisfies RequiredFeature);
