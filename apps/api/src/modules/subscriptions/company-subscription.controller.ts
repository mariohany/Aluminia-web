import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '@repo/types/auth';
import type { CompanySubscription } from '@repo/types/subscriptions';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import {
  CompanySubscriptionService,
  subscriptionOf,
} from './company-subscription.service';
import { PickFreeProjectDto } from './dto/pick-free-project.dto';

@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller('company/subscription')
export class CompanySubscriptionController {
  constructor(private readonly subscription: CompanySubscriptionService) {}

  @Get()
  get(@Req() request: Request): Promise<CompanySubscription> {
    return this.subscription.get(subscriptionOf(request));
  }

  @Post('free-project')
  @HttpCode(200)
  @Roles(UserRole.COMPANY_ADMIN)
  pickFreeProject(
    @Req() request: Request,
    @Body() dto: PickFreeProjectDto,
  ): Promise<CompanySubscription> {
    return this.subscription.pickFreeProject(
      subscriptionOf(request),
      dto.projectId,
    );
  }
}
