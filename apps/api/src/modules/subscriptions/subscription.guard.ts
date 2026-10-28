import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  REQUIRES_FEATURE_KEY,
  type RequiredFeature,
} from '../../common/decorators/requires-feature.decorator';
import { SubscriptionsService } from './subscriptions.service';
import {
  PLAN_DEACTIVATED_MESSAGE,
  SUBSCRIPTION_ENDED_MESSAGE,
} from './subscription-access';

/**
 * Every request of a company user passes the company's plan
 * (docs/subscriptions_planing.md §4a, §4b):
 *
 * - a paid plan past its end blocks everything: 403 `subscription_ended`
 *   (B10; login and refresh refuse too, in AuthService);
 * - a trial past its end drops the company to Free on the spot (B11), and
 *   a user that drop deactivated gets 401 `plan_deactivated`;
 * - `@RequiresFeature` routes answer 403 `feature_locked` without the
 *   feature (B12).
 *
 * It attaches `request.subscription` for the Free limits and read-only
 * projects (PlanAccess). Registered in SubscriptionsModule, imported after
 * TenancyModule, so `request.user` is set. Super admins and public routes
 * pass untouched.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user?.companyId) return true;

    const found = await this.subscriptions.access(user.companyId);
    if (!found) return true;
    if (found.deactivated.includes(user.id)) {
      throw new UnauthorizedException({
        message: PLAN_DEACTIVATED_MESSAGE,
        code: 'plan_deactivated',
      });
    }
    const { access } = found;
    if (access.state.kind === 'expired') {
      throw new ForbiddenException({
        message: SUBSCRIPTION_ENDED_MESSAGE,
        code: 'subscription_ended',
      });
    }
    request.subscription = access;

    const required = this.reflector.getAllAndOverride<
      RequiredFeature | undefined
    >(REQUIRES_FEATURE_KEY, targets);
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (
      required &&
      !(required.writesOnly && isRead) &&
      !access.features.includes(required.feature)
    ) {
      throw new ForbiddenException({
        message: 'This needs a paid plan.',
        code: 'feature_locked',
      });
    }
    return true;
  }
}
