import { ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { LoginAttemptsService } from '../../modules/auth/login-attempts.service';

/**
 * Stability S9, per caller: what each Redis user does when every
 * command fails. test/redis-outage.e2e-spec.ts runs the same against a
 * real unreachable Redis.
 */
const down = () => Promise.reject(new Error('Connection is closed.'));
const deadRedis = {
  eval: jest.fn(down),
  get: jest.fn(down),
  pttl: jest.fn(down),
  del: jest.fn(down),
  multi: jest.fn(() => {
    const chain = {
      incr: () => chain,
      pexpire: () => chain,
      exec: down,
    };
    return chain;
  }),
} as unknown as Redis;

describe('RedisThrottlerStorage with Redis down', () => {
  it('lets the request through uncounted', async () => {
    const storage = new RedisThrottlerStorage(deadRedis);
    await expect(
      storage.increment(
        'Controller.handler:default:ip:1.2.3.4',
        60_000,
        1,
        60_000,
      ),
    ).resolves.toEqual({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });
});

describe('LoginAttemptsService with Redis down', () => {
  const service = new LoginAttemptsService(deadRedis);

  it('refuses the login with a 503, never skipping the limit', async () => {
    await expect(
      service.assertAllowed('user@acme.local', '1.2.3.4'),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  // By then the check passed, so Redis was up a moment ago: recording is
  // best-effort and must not turn a 401 or a login into a 500.
  it('records results best-effort', async () => {
    await expect(
      service.recordFailure('user@acme.local', '1.2.3.4'),
    ).resolves.toBeUndefined();
    await expect(
      service.recordSuccess('user@acme.local'),
    ).resolves.toBeUndefined();
  });
});
