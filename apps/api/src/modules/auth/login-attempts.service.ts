import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis.module';
import { logRedisFallback } from '../../common/redis-fallback';
import {
  LOGIN_FAILURE_LIMIT_PER_EMAIL,
  LOGIN_FAILURE_LIMIT_PER_IP,
  LOGIN_FAILURE_WINDOW_MS,
} from './auth.constants';
import { TooManyLoginAttemptsException } from './too-many-login-attempts.exception';

export const LOGIN_FAILURE_KEY_PREFIX = 'login-fail:';

/**
 * Limits failed logins (stability S1), counted two ways at once: per
 * email, so guesses can't be spread over many IPs against one account,
 * and per IP, so one caller can't spread guesses over many accounts.
 * Only failures count — an office of staff logging in from one IP never
 * gets near it. The check runs before the password hash is verified, so
 * a blocked caller costs no argon2 work.
 *
 * Fixed window from the first failure; a successful login clears that
 * email's count (not the IP's).
 *
 * Redis down (stability S9): logins are refused with a 503 rather than
 * let through uncounted, so the limit is never off (Mario's call).
 * People already signed in are unaffected. Recording a result is
 * best-effort: by then the check has passed, so Redis was up a moment ago.
 */
@Injectable()
export class LoginAttemptsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async assertAllowed(email: string, ip: string): Promise<void> {
    const emailKey = this.emailKey(email);
    const ipKey = this.ipKey(ip);
    let counts: [string | null, number, string | null, number];
    try {
      counts = await Promise.all([
        this.redis.get(emailKey),
        this.redis.pttl(emailKey),
        this.redis.get(ipKey),
        this.redis.pttl(ipKey),
      ]);
    } catch (error: unknown) {
      logRedisFallback('login limit', error, 'logins are refused');
      throw new ServiceUnavailableException(
        'Sign-in is temporarily unavailable. Try again in a minute.',
      );
    }
    const [emailHits, emailTtl, ipHits, ipTtl] = counts;

    let retryMs = 0;
    if (Number(emailHits) >= LOGIN_FAILURE_LIMIT_PER_EMAIL)
      retryMs = Math.max(retryMs, emailTtl);
    if (Number(ipHits) >= LOGIN_FAILURE_LIMIT_PER_IP)
      retryMs = Math.max(retryMs, ipTtl);
    if (retryMs > 0) {
      throw new TooManyLoginAttemptsException(Math.ceil(retryMs / 1000));
    }
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    try {
      await this.redis
        .multi()
        .incr(this.emailKey(email))
        .pexpire(this.emailKey(email), LOGIN_FAILURE_WINDOW_MS, 'NX')
        .incr(this.ipKey(ip))
        .pexpire(this.ipKey(ip), LOGIN_FAILURE_WINDOW_MS, 'NX')
        .exec();
    } catch (error: unknown) {
      logRedisFallback('login limit', error, 'a failure went uncounted');
    }
  }

  async recordSuccess(email: string): Promise<void> {
    try {
      await this.redis.del(this.emailKey(email));
    } catch (error: unknown) {
      logRedisFallback('login limit', error, 'a count was not cleared');
    }
  }

  // Hashed so the keys don't hold users' email addresses in the clear.
  private emailKey(email: string): string {
    const normalized = email.trim().toLowerCase();
    return `${LOGIN_FAILURE_KEY_PREFIX}email:${createHash('sha256').update(normalized).digest('hex')}`;
  }

  private ipKey(ip: string): string {
    return `${LOGIN_FAILURE_KEY_PREFIX}ip:${ip}`;
  }
}
