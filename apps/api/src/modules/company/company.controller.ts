import { Controller, Get, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { CompanyOverview } from '@repo/types/users';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { CompanyService } from './company.service';

/**
 * The caller's own company. Open to plain users as well as admins —
 * everyone in the workspace needs the company name in the chrome, and
 * the seat numbers are not sensitive within a company.
 */
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@Controller('company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get('me')
  me(@CurrentUser() actor: AuthenticatedRequestUser): Promise<CompanyOverview> {
    if (!actor.companyId) {
      throw new ForbiddenException('This route requires a company.');
    }
    return this.company.overview(actor.companyId);
  }
}
