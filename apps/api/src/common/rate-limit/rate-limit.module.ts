import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis.module';
import { AppThrottlerGuard } from './app-throttler.guard';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * A rate limit on every route (stability S1): 600 requests a minute per
 * user (per IP on public routes) — far above real use, there to stop a
 * runaway script or a flood. Routes tighten it with `@Throttle`
 * (quote requests, refresh, logout). Login has its own limit on failed
 * attempts (`LoginAttemptsService`), on top of this one.
 *
 * Import after AuthModule: global guards run in registration order, and
 * this one needs `request.user` from JwtAuthGuard.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: minutes(1), limit: 600 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class RateLimitModule {}
