import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type {
  CompaniesPerMonthPoint,
  DashboardSummary,
} from '@repo/types/dashboard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { CompaniesPerMonthQueryDto } from './dto/companies-per-month-query.dto';

@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(): Promise<DashboardSummary> {
    return this.dashboard.summary();
  }

  @Get('companies-per-month')
  companiesPerMonth(
    @Query() { from, to }: CompaniesPerMonthQueryDto,
  ): Promise<CompaniesPerMonthPoint[]> {
    return this.dashboard.companiesPerMonth(from, to);
  }
}
