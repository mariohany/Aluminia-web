import { Injectable } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { LookupEntity, type LookupVersion } from '@repo/types/lookups';
import { CompanyLookupMeta } from '../../database/tenant/entities/company-lookup-meta.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * The company's lookup versions (`company_lookup_meta`, bumped by triggers)
 * inside a tenant run that is already open — a slice reads them in the
 * same transaction as its rows. Read them BEFORE the rows: a write landing
 * in between then leaves the client with newer data under an older
 * version, which only costs one extra refetch, never a missed change.
 */
export async function readCompanyLookupVersions(
  manager: EntityManager,
  entities: readonly LookupEntity[],
): Promise<Partial<LookupVersion>> {
  const rows = await manager.find(CompanyLookupMeta, {
    where: { id: In([...entities]) },
  });
  return Object.fromEntries(rows.map((row) => [row.id, row.version]));
}

// GET /company/lookups/version (docs/lookup_caching_planing.md D3).
@Injectable()
export class CompanyLookupVersionsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  getVersions(): Promise<LookupVersion> {
    return this.tenantContext.run(
      (manager) =>
        readCompanyLookupVersions(
          manager,
          Object.values(LookupEntity),
        ) as Promise<LookupVersion>,
    );
  }
}
