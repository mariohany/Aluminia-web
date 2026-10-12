import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// Longer than any command takes on a healthy Redis, short enough that a
// request waiting on a dead one falls back quickly.
export const REDIS_COMMAND_TIMEOUT_MS = 500;

/**
 * The app's Redis client, built to fail fast (stability S9): every use
 * of Redis has a fallback (the throttle lets requests through, caches
 * read Postgres; only the failed-login check refuses), and a fallback
 * is only useful if the failure arrives quickly.
 *
 * - `enableOfflineQueue: false`: by default ioredis holds commands
 *   while disconnected and retries them through up to 20 reconnects, so
 *   every request would hang for seconds before falling back. Now a
 *   command fails at once while Redis is unreachable, and ioredis keeps
 *   reconnecting in the background regardless.
 * - `commandTimeout`: the same for a Redis that is connected but not
 *   answering.
 * - The `error` listener: an EventEmitter with no `error` listener
 *   throws, so a Redis blip would crash the process. Logged once per
 *   outage, with a line when it's back.
 *
 * Not for BullMQ, which needs `maxRetriesPerRequest: null` and its own
 * connection.
 */
export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    connectTimeout: 2_000,
  });
  const logger = new Logger('Redis');
  let down = false;
  client.on('error', (error: unknown) => {
    if (down) return;
    down = true;
    logger.error(
      { err: error },
      'Redis unavailable; falling back until it reconnects',
    );
  });
  client.on('ready', () => {
    if (!down) return;
    down = false;
    logger.log('Redis reconnected');
  });
  return client;
}

/**
 * Waits for the first connection, up to `timeoutMs`. With no offline
 * queue, a command sent before the connection is up fails, so without
 * this the first requests after boot would fall back for nothing. A
 * Redis that is down at boot doesn't stop the app: it starts with the
 * fallbacks and picks Redis up when it comes back.
 */
export async function waitForRedis(
  client: Redis,
  timeoutMs = 2_000,
): Promise<void> {
  if (client.status === 'ready') return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      client.off('ready', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    client.once('ready', done);
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>) => {
        const client = createRedisClient(
          config.get('REDIS_URL', { infer: true }),
        );
        await waitForRedis(client);
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  // Without this, the client's open socket keeps the event loop alive
  // past app.close() — harmless in a long-running server, but it leaves
  // tests (and `node --run` scripts) hanging instead of exiting.
  // A Redis that is down can't answer QUIT; drop the socket instead.
  async onApplicationShutdown() {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
