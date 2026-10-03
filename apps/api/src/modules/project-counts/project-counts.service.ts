import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Redis from 'ioredis';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { REDIS_CLIENT } from '../../common/redis.module';
import { TenantConnectionService } from '../tenancy/tenant-connection.service';

// Short-lived, not version-keyed like the lookups cache: there's no
// write path that could bump a "projects changed" version, since a
// project write happens inside some tenant's own schema with no signal
// back to the control plane. A plain TTL is the whole mechanism — "cached
// for a minute or two" is enough for numbers an admin glances at.
const CACHE_KEY = 'project-counts:by-company';
const CACHE_TTL_SECONDS = 90;

/**
 * Projects per company, for the dashboard's total and the Companies
 * page's Projects column (docs/admin_redesign_planing.md §3). One fan-out
 * across every **active** company's schema, cached as a single JSON
 * object so both readers share it.
 *
 * Archived companies are skipped deliberately: their schema still exists
 * (archiving never drops it), but a suspended company's project count
 * isn't "current" — callers show them as "—".
 */
@Injectable()
export class ProjectCountsService {
  constructor(
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    private readonly tenantConnection: TenantConnectionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async byCompany(): Promise<Map<string, number>> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached !== null) {
      return new Map(
        Object.entries(JSON.parse(cached) as Record<string, number>),
      );
    }

    const activeCompanies = await this.companies.find({
      where: { status: CompanyStatus.ACTIVE },
      select: { id: true, schemaName: true },
    });
    const counts = await Promise.all(
      activeCompanies.map(
        async (company) =>
          [
            company.id,
            await this.tenantConnection.runInSchema(
              company.schemaName,
              (manager) => manager.count(Project),
            ),
          ] as const,
      ),
    );
    const byCompany = new Map(counts);

    await this.redis.set(
      CACHE_KEY,
      JSON.stringify(Object.fromEntries(byCompany)),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return byCompany;
  }

  async total(): Promise<number> {
    let sum = 0;
    for (const count of (await this.byCompany()).values()) sum += count;
    return sum;
  }
}
