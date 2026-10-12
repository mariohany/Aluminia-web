import type Redis from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { logRedisFallback } from '../redis-fallback';

// Not exported from the package root.
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

// One round trip, atomic: a caller that is blocked isn't counted (same as
// the library's in-memory store); otherwise count the hit in a fixed
// window, and on going over the limit block for `blockDuration` and start
// the window afresh, so the block's end is a clean slate.
// Returns { hits, windowMs, blocked (0/1), blockMs }.
const INCREMENT_SCRIPT = `
local block = redis.call('PTTL', KEYS[2])
if block > 0 then
  return { tonumber(ARGV[2]) + 1, block, 1, block }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

export const THROTTLE_KEY_PREFIX = 'throttle:';

/**
 * `@nestjs/throttler` storage in Redis rather than process memory
 * (stability S1): with more than one API instance, in-memory counters
 * would each allow the full limit, multiplying it by the instance count.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    let reply: [number, number, number, number];
    try {
      reply = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${THROTTLE_KEY_PREFIX}${key}`,
        `${THROTTLE_KEY_PREFIX}${key}:block`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
    } catch (error: unknown) {
      // Redis down: let the request through uncounted (stability S9,
      // Mario's call: an outage shouldn't take the app down with it).
      // The failed-login limit is separate and does refuse.
      logRedisFallback('rate limit', error, 'requests are not counted');
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
    const [hits, windowMs, blocked, blockMs] = reply;
    // The guard expects seconds, rounded up, like the in-memory store.
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(windowMs / 1000)),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
    };
  }
}
