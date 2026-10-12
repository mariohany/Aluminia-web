import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequestUser } from '../../modules/auth/jwt-payload';

/**
 * The global rate limit, counted per logged-in user, or per IP when
 * there is no user (the public routes). Per user so several staff behind
 * one office IP don't share a budget. Runs after JwtAuthGuard (it is
 * registered in RateLimitModule, imported after AuthModule), so
 * `request.user` is already set.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as AuthenticatedRequestUser | undefined;
    const ip = typeof req.ip === 'string' ? req.ip : 'unknown';
    return Promise.resolve(user ? `user:${user.id}` : `ip:${ip}`);
  }

  // Readable instead of the library's hash — `LeadsController.create:
  // default:ip:1.2.3.4` — so a count can be found (and cleared) in Redis
  // by route and caller.
  protected generateKey(
    context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `${context.getClass().name}.${context.getHandler().name}:${name}:${tracker}`;
  }
}
