import type { Repository } from 'typeorm';
import type Redis from 'ioredis';
import { ProjectCountsService } from './project-counts.service';
import type { Company } from '../../database/control-plane/entities/company.entity';
import type { TenantConnectionService } from '../tenancy/tenant-connection.service';

// Plain fakes, same approach as auth.service.spec.ts: the service takes
// plain constructor params, so no DI container is needed.
function makeService(cached: string | null) {
  const store = { value: cached };
  const redis = {
    get: jest.fn(() => Promise.resolve(store.value)),
    set: jest.fn((_key: string, value: string) => {
      store.value = value;
      return Promise.resolve('OK');
    }),
  };
  const companies = {
    find: jest.fn().mockResolvedValue([
      { id: 'c1', schemaName: 'tenant_one' },
      { id: 'c2', schemaName: 'tenant_two' },
    ]),
  };
  const perSchema: Record<string, number> = { tenant_one: 3, tenant_two: 5 };
  const tenantConnection = {
    runInSchema: jest.fn(
      (
        schema: string,
        work: (m: { count: () => Promise<number> }) => Promise<number>,
      ) => work({ count: () => Promise.resolve(perSchema[schema]) }),
    ),
  };
  const service = new ProjectCountsService(
    companies as unknown as Repository<Company>,
    tenantConnection as unknown as TenantConnectionService,
    redis as unknown as Redis,
  );
  return { service, redis, companies, tenantConnection };
}

describe('ProjectCountsService', () => {
  it('counts every active company once and caches the result', async () => {
    const { service, redis, tenantConnection } = makeService(null);

    const counts = await service.byCompany();

    expect(Object.fromEntries(counts)).toEqual({ c1: 3, c2: 5 });
    expect(tenantConnection.runInSchema).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledWith(
      'project-counts:by-company',
      JSON.stringify({ c1: 3, c2: 5 }),
      'EX',
      90,
    );
  });

  it('serves the cached counts without touching any tenant schema', async () => {
    const { service, companies, tenantConnection } = makeService(
      JSON.stringify({ c1: 7 }),
    );

    expect(Object.fromEntries(await service.byCompany())).toEqual({ c1: 7 });
    expect(companies.find).not.toHaveBeenCalled();
    expect(tenantConnection.runInSchema).not.toHaveBeenCalled();
  });

  it('totals the per-company counts', async () => {
    const { service } = makeService(null);
    expect(await service.total()).toBe(8);
  });
});
