import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis.module';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Reports Redis without failing /health on it (stability S9): every use
   * of Redis falls back while it's down, so the app still serves, and
   * failing here would make the load balancer pull every instance at
   * once (they all share the one Redis). Shown as
   * `redis: { status: 'up', connected: false }` so monitoring can alert
   * on it.
   */
  async pingCheck(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.redis.ping();
      return indicator.up({ connected: true });
    } catch (error: unknown) {
      return indicator.up({
        connected: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
