import { Controller, Get } from '@nestjs/common';
import { TenantScoped } from '../../src/common/decorators/tenant-scoped.decorator';
import { TenantContextService } from '../../src/modules/tenancy/tenant-context.service';
import { TenantInfo } from '../../src/database/tenant/entities/tenant-info.entity';

export interface TenantWhoamiResponse {
  companyId: string;
  companyName: string;
  provisionedAt: string;
}

/**
 * TEST-ONLY. Exists so the isolation tests below have something to call
 * over real HTTP — proving TenantGuard and TenantContextService wired
 * together end to end is the actual point of Phase 3, and calling the
 * services directly (as tenant-context.e2e-spec.ts does for Phase 2)
 * would skip the guard chain, which is a real part of the request and a
 * real place to get it wrong.
 *
 * Deliberately lives under apps/api/test/, mounted only by
 * TenantWhoamiTestModule (also test-only), never imported by AppModule
 * or anything under apps/api/src. See docs/tenant_resolver_planing.md
 * Phase 3 for why.
 */
@Controller('tenant')
export class TenantWhoamiController {
  constructor(private readonly tenantContext: TenantContextService) {}

  @Get('whoami')
  @TenantScoped()
  whoami(): Promise<TenantWhoamiResponse> {
    return this.tenantContext.run(async (manager) => {
      const [info] = await manager.find(TenantInfo);
      return {
        companyId: info.companyId,
        companyName: info.companyName,
        provisionedAt: info.provisionedAt.toISOString(),
      };
    });
  }
}
