import { Body, Controller, Get, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { UserRole } from '@repo/types/auth';
import {
  updateBillingProfileSchema,
  type BillingProfile,
} from '@repo/types/billing-profile';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { BillingProfileService } from './billing-profile.service';

class UpdateBillingProfileDto extends createZodDto(
  updateBillingProfileSchema,
) {}

/** Billing › Billing profile (docs/subscriptions_planing.md B17): super admin only. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/billing-profile')
export class AdminBillingProfileController {
  constructor(private readonly profile: BillingProfileService) {}

  @Get()
  get(): Promise<BillingProfile> {
    return this.profile.get();
  }

  @Put()
  update(
    @Body() dto: UpdateBillingProfileDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BillingProfile> {
    return this.profile.update(dto, actor.id);
  }
}
