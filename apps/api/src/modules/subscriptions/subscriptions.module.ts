import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionGuard } from './subscription.guard';
import { PlanAccess } from './plan-access.service';
import { CompanySubscriptionService } from './company-subscription.service';
import { CompanySubscriptionController } from './company-subscription.controller';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [CompanySubscriptionController],
  providers: [
    SubscriptionsService,
    PlanAccess,
    CompanySubscriptionService,
    // After JwtAuthGuard (AuthModule) and TenantGuard (TenancyModule):
    // AppModule imports this module after both, and global guards run in
    // registration order.
    { provide: APP_GUARD, useClass: SubscriptionGuard },
  ],
  exports: [SubscriptionsService, PlanAccess],
})
export class SubscriptionsModule {}
