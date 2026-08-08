import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { UserSummary } from '@repo/types/users';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { UsersService } from '../users/users.service';
import { CreateCompanyUserDto } from './dto/create-company-user.dto';
import { DeleteCompanyUserDto } from './dto/delete-company-user.dto';
import { ResetCompanyUserPasswordDto } from './dto/reset-company-user-password.dto';

/**
 * A company admin managing their own company's users.
 *
 * **Not** `@TenantScoped()`, and that is not an oversight: `users` is
 * control-plane data. "Company admin manages their users" sounds
 * tenant-shaped and isn't — the tenant schema holds business data,
 * never identity.
 *
 * The security boundary is `companyId`, and it comes from
 * `@CurrentUser()` — the verified JWT — on every method. It is never
 * read from the body or a path parameter, so there is no id a caller
 * can pass to reach another company. The service applies it inside the
 * same query that loads the row, so a user outside the caller's company
 * is simply not found: a 404, never a 403, because a 403 would confirm
 * that the user exists.
 */
@Roles(UserRole.COMPANY_ADMIN)
@Controller('company/users')
export class CompanyUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedRequestUser): Promise<UserSummary[]> {
    return this.users.listForCompany(companyOf(actor));
  }

  /**
   * Creates a plain `user`, always. The role is set here rather than
   * accepted from the request, and `CreateCompanyUserDto` carries no
   * `role` field to begin with — a company admin cannot mint another
   * admin. Only a super admin does that, which is the deliberate
   * recovery path when a company loses its only admin.
   *
   * Delegates to the same `create` the super-admin route uses, so the
   * seat limit is enforced by the one transaction that takes a row lock
   * on the company before counting.
   */
  @Post()
  create(
    @Body() dto: CreateCompanyUserDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<UserSummary> {
    return this.users.create(
      {
        email: dto.email,
        password: dto.password,
        role: UserRole.USER,
        companyId: companyOf(actor),
      },
      actor.id,
    );
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<UserSummary> {
    return this.users.deactivate(id, actor.id, companyOf(actor));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<UserSummary> {
    return this.users.reactivate(id, actor.id, companyOf(actor));
  }

  /**
   * The only password-recovery path that exists, since there is no
   * email pipeline: a colleague forgets their password and the company
   * admin sets a new one. Revokes their session too, via the shared
   * service.
   */
  @Post(':id/reset-password')
  @HttpCode(204)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetCompanyUserPasswordDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.users.resetPassword(id, dto.password, actor.id, companyOf(actor));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteCompanyUserDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.users.remove(id, dto.confirmEmail, actor.id, companyOf(actor));
  }
}

/**
 * A `company_admin` always has a `companyId` — the control-plane check
 * constraint from Phase 4 requires it for every non-super-admin, and
 * RolesGuard has already established the role by the time this runs.
 * This exists so the impossible case fails loudly rather than silently
 * widening the query to every company.
 */
function companyOf(actor: AuthenticatedRequestUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException('This route requires a company.');
  }
  return actor.companyId;
}
