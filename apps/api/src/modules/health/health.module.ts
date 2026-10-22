import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';
import { RootController } from './root.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, RootController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
