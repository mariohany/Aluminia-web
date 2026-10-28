import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { CompanyAlerts } from '@repo/types/alerts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { CompanyAlertsService } from './company-alerts.service';

/** Called by the web each time a user opens the app (Q2). */
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@Controller('company/alerts')
export class CompanyAlertsController {
  constructor(private readonly alerts: CompanyAlertsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedRequestUser): Promise<CompanyAlerts> {
    if (!user.companyId) {
      throw new ForbiddenException('This route requires a company.');
    }
    return this.alerts.alerts({ companyId: user.companyId, role: user.role });
  }
}
