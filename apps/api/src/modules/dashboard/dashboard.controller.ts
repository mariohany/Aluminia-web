import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type {
  CompaniesPerMonthPoint,
  DashboardBilling,
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

  /** The Leads card's Ending soon / Unpaid quotations / Expired tabs (B22). */
  @Get('billing')
  billing(): Promise<DashboardBilling> {
    return this.dashboard.billing();
  }

  @Get('companies-per-month')
  companiesPerMonth(
    @Query() { from, to }: CompaniesPerMonthQueryDto,
  ): Promise<CompaniesPerMonthPoint[]> {
    return this.dashboard.companiesPerMonth(from, to);
  }
}
