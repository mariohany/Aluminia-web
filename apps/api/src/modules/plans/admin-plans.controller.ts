import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { PlanSummary } from '@repo/types/plans';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { PlansService } from './plans.service';
import { UpdatePlansDto } from './dto/update-plans.dto';

/**
 * The admin Plans page (docs/subscriptions_planing.md B1): the four
 * fixed plans, and one Save for the three paid ones. Free is fixed in
 * code and only listed here.
 */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list(): Promise<PlanSummary[]> {
    return this.plans.list();
  }

  @Put()
  update(
    @Body() dto: UpdatePlansDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<PlanSummary[]> {
    return this.plans.updatePaid(dto.plans, actor.id);
  }
}
