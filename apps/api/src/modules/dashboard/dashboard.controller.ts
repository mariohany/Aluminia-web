import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { DashboardSummary } from '@repo/types/dashboard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(): Promise<DashboardSummary> {
    return this.dashboard.summary();
  }
}
