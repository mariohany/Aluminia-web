import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger.module';
import { RedisModule } from './common/redis.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ControlPlaneDatabaseModule } from './database/control-plane/typeorm.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    RedisModule,
    ControlPlaneDatabaseModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
