import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger.module';
import { RedisModule } from './common/redis.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { NoStoreMiddleware } from './common/middleware/no-store.middleware';
import { ControlPlaneDatabaseModule } from './database/control-plane/typeorm.module';
import { TenantDatabaseModule } from './database/tenant/typeorm.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { UsersModule } from './modules/users/users.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { LogsModule } from './modules/admin-logs/logs.module';
import { LookupsModule } from './modules/lookups/lookups.module';
import { CompanyLookupsModule } from './modules/company-lookups/company-lookups.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ProjectSettingsModule } from './modules/project-settings/project-settings.module';
import { WindowsModule } from './modules/windows/windows.module';
import { CompanyModule } from './modules/company/company.module';
import { LeadsModule } from './modules/leads/leads.module';
import { PlansModule } from './modules/plans/plans.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StorageModule } from './storage/storage.module';
import { FilesModule } from './modules/files/files.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    RedisModule,
    ControlPlaneDatabaseModule,
    TenantDatabaseModule,
    StorageModule,
    HealthModule,
    AuthModule,
    // After AuthModule: its guard keys the limit on request.user.
    RateLimitModule,
    TenancyModule,
    // After TenancyModule: its guard (SubscriptionGuard) needs request.user.
    SubscriptionsModule,
    AuditLogModule,
    CompaniesModule,
    UsersModule,
    DashboardModule,
    LogsModule,
    LookupsModule,
    CompanyLookupsModule,
    ClientsModule,
    ProjectsModule,
    ProjectSettingsModule,
    WindowsModule,
    CompanyModule,
    LeadsModule,
    PlansModule,
    ReportsModule,
    FilesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Registered here rather than only via main.ts's
    // `app.useGlobalPipes()` so it's also active inside every e2e test —
    // those build the Nest app straight from `AppModule` via
    // `Test.createTestingModule()` + `createNestApplication()`, which
    // never runs `bootstrap()`. Before this, no e2e test actually
    // exercised body validation at all; invalid input reached services
    // unvalidated in every test run, silently, because the assertion
    // that would have caught it never had a functioning pipe behind it.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule implements NestModule {
  // Here rather than in main.ts for the same reason as the pipe above:
  // e2e builds the app from AppModule and never runs bootstrap().
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(NoStoreMiddleware).forRoutes('*');
  }
}
