import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import type { Logger } from 'pino';
import { TENANT_SCOPED_KEY } from '../../../common/decorators/tenant-scoped.decorator';
import {
  Company,
  CompanyStatus,
} from '../../../database/control-plane/entities/company.entity';
import { assertValidSchemaName } from '../../../database/tenant/schema-name';

/**
 * The control-plane half of tenant resolution — everything that can be
 * decided WITHOUT opening a connection to the tenant schema itself.
 * (The remaining check — does this schema's own `tenant_info` row agree
 * with the claim? — happens on the first tenant query, in
 * `TenantContextService`, because it needs a tenant connection to ask.)
 *
 * Runs after JwtAuthGuard and RolesGuard (registered later, in
 * TenancyModule, and NestJS applies global guards in registration
 * order — see AppModule's import order), so `request.user` is already
 * populated by the time this executes.
 *
 * Opt-in via @TenantScoped(), like @Roles(): a route with no
 * @TenantScoped() is left alone entirely.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isTenantScoped = this.reflector.getAllAndOverride<boolean>(
      TENANT_SCOPED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isTenantScoped) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { log?: Logger }>();

    // Gate: authenticated, but no companyId — a super admin, who belongs
    // to no company. There is no correct schema to pick, so this route
    // is structurally unreachable to them.
    const companyId = request.user?.companyId;
    if (!companyId) {
      throw new ForbiddenException('This route requires a company.');
    }

    // Gate: the claim has to resolve to a real, currently active
    // company. Re-checked live on every request rather than trusted
    // from token-issue time — an access token stays valid for its full
    // ~15 minutes regardless of what happens to the company in the
    // meantime, and archiving already revokes sessions but not
    // already-issued tokens.
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) {
      throw new UnauthorizedException('Unknown company.');
    }
    if (company.status !== CompanyStatus.ACTIVE) {
      throw new ForbiddenException('This company is not active.');
    }

    // Defensive: schema names are validated at derivation (Phase 5) and
    // re-validated immediately before every use, including here — a
    // hand-edited or corrupted row should fail loudly, not execute.
    assertValidSchemaName(company.schemaName);

    request.tenant = {
      companyId: company.id,
      companyName: company.name,
      schemaName: company.schemaName,
    };

    // Best-effort: attaches companyId to every subsequent log line for
    // this request, alongside the request id LoggerModule already adds.
    // pino-http's per-request child logger lands on `request.log`
    // before any guard runs, but nothing here depends on it existing.
    request.log?.setBindings?.({ companyId: company.id });

    return true;
  }
}
