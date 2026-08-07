import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { TenantInfo } from '../../database/tenant/entities/tenant-info.entity';
import { TenantConnectionService } from './tenant-connection.service';
import type { ResolvedTenant } from './resolved-tenant';

/**
 * The ergonomic, per-request entry point for tenant-scoped queries.
 * `TenantConnectionService` (a singleton) is the mechanism; this is the
 * request-aware wrapper controllers and services actually inject.
 *
 * Request-scoped so the `tenantInfoVerified` flag below is safe to cache
 * on `this` — Nest gives every request its own instance, so there's no
 * risk of one request's cross-check leaking into another's.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private tenantInfoVerified = false;

  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly tenantConnection: TenantConnectionService,
  ) {}

  /**
   * The tenant `TenantGuard` already resolved for this request. Throws
   * if it's missing — which means a route is using this service without
   * `@TenantScoped()` on it, a wiring mistake to fail loudly on rather
   * than silently proceed without a tenant.
   */
  private getResolvedTenant(): ResolvedTenant {
    if (!this.request.tenant) {
      throw new InternalServerErrorException(
        'TenantContextService used on a route with no @TenantScoped() guard.',
      );
    }
    return this.request.tenant;
  }

  /**
   * Runs `work` inside this request's tenant schema.
   *
   * On the first call per request, also confirms the schema's own
   * `tenant_info` row names the same company the JWT claimed — defence
   * in depth against a resolved schema that isn't actually who it says
   * it is. Cached after that first check so later calls in the same
   * request don't repeat it.
   */
  async run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const { companyId, schemaName } = this.getResolvedTenant();

    return this.tenantConnection.runInSchema(schemaName, async (manager) => {
      if (!this.tenantInfoVerified) {
        const [info] = await manager.find(TenantInfo);
        if (!info || info.companyId !== companyId) {
          throw new Error(
            `Tenant schema "${schemaName}" tenant_info does not match the resolved company ${companyId}.`,
          );
        }
        this.tenantInfoVerified = true;
      }

      return work(manager);
    });
  }
}
