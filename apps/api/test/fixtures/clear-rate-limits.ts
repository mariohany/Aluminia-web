import type { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../src/common/redis.module';
import { THROTTLE_KEY_PREFIX } from '../../src/common/rate-limit/redis-throttler.storage';

/**
 * Rate-limit counts live in Redis and outlast a test run, and every e2e
 * request comes from the same local IP. A suite that exercises a limited
 * public route calls this first for that route (`'LeadsController.create'`),
 * so a rerun within the window doesn't start out blocked.
 *
 * Only the local caller's count for the named routes is cleared: suites
 * run in parallel, and wiping every key would reset another suite's
 * count halfway through its own test.
 */
export async function clearRateLimits(
  app: INestApplication,
  ...routes: string[]
): Promise<void> {
  const redis = app.get<Redis>(REDIS_CLIENT);
  for (const route of routes) {
    for (const local of ['127.0.0.1', '::1']) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH',
          `${THROTTLE_KEY_PREFIX}${route}:*:ip:*${local}*`,
          'COUNT',
          500,
        );
        if (keys.length > 0) await redis.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    }
  }
}
