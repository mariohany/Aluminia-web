import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis.module';
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
 */
@Injectable()
export class LoginAttemptsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async assertAllowed(email: string, ip: string): Promise<void> {
    const emailKey = this.emailKey(email);
    const ipKey = this.ipKey(ip);
    const [emailHits, emailTtl, ipHits, ipTtl] = await Promise.all([
      this.redis.get(emailKey),
      this.redis.pttl(emailKey),
      this.redis.get(ipKey),
      this.redis.pttl(ipKey),
    ]);

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
    await this.redis
      .multi()
      .incr(this.emailKey(email))
      .pexpire(this.emailKey(email), LOGIN_FAILURE_WINDOW_MS, 'NX')
      .incr(this.ipKey(ip))
      .pexpire(this.ipKey(ip), LOGIN_FAILURE_WINDOW_MS, 'NX')
      .exec();
  }

  async recordSuccess(email: string): Promise<void> {
    await this.redis.del(this.emailKey(email));
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
