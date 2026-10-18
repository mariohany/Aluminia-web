import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import type { BumpedVersion } from '../auth/auth-version.service';

/**
 * Stability S21: the guards in front of companies.service's destructive
 * operations (above all, that only an archived company is ever
 * dropped) and the seat-limit rule on update (S13), against a fake
 * QueryRunner. `events` records the order of what happened, so the
 * tests can check that the schema is never dropped and nothing is
 * published unless the transaction commits.
 */

const ACTOR = 'actor-1';

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-a',
    name: 'Acme',
    schemaName: 'tenant_acme',
    status: CompanyStatus.SUSPENDED,
    plan: 'starter',
    maxUsers: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(company: Company | null, userCount = 0) {
  const events: string[] = [];
  const manager = {
    findOne: jest.fn(() => Promise.resolve(company)),
    find: jest.fn(() =>
      Promise.resolve(
        Array.from({ length: userCount }, (_, i) => ({ id: `user-${i}` })),
      ),
    ),
    count: jest.fn(() => Promise.resolve(userCount)),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    insert: jest.fn((entity: unknown) => {
      if (entity === BillingRecord) events.push('billing');
      return Promise.resolve();
    }),
    delete: jest.fn((entity: unknown) => {
      events.push(
        entity === User
          ? 'delete-users'
          : entity === Company
            ? 'delete-company'
            : 'delete',
      );
      return Promise.resolve();
    }),
  };
  const queryRunner = {
    isTransactionActive: false,
    manager,
    connect: jest.fn(() => Promise.resolve()),
    startTransaction: jest.fn(() => {
      queryRunner.isTransactionActive = true;
      return Promise.resolve();
    }),
    commitTransaction: jest.fn(() => {
      queryRunner.isTransactionActive = false;
      events.push('commit');
      return Promise.resolve();
    }),
    rollbackTransaction: jest.fn(() => {
      queryRunner.isTransactionActive = false;
      events.push('rollback');
      return Promise.resolve();
    }),
    release: jest.fn(() => Promise.resolve()),
    query: jest.fn((sql: string) => {
      if (sql.startsWith('DROP SCHEMA')) events.push(sql);
      if (sql.startsWith('DELETE FROM "sessions"')) events.push('end-sessions');
      return Promise.resolve([]);
    }),
  };
  const dataSource = { createQueryRunner: () => queryRunner };
  const users = { count: jest.fn(() => Promise.resolve(userCount)) };
  const authVersions = {
    bump: jest.fn((): Promise<BumpedVersion[]> => {
      events.push('bump');
      return Promise.resolve([{ userId: 'user-0', version: 1 }]);
    }),
    publish: jest.fn(() => {
      events.push('publish');
      return Promise.resolve();
    }),
    publishDeleted: jest.fn((ids: string[]) => {
      events.push(`publish-deleted:${ids.length}`);
      return Promise.resolve();
    }),
  };
  const auditLog = { record: jest.fn(() => Promise.resolve()) };
  const files = {
    deleteCompanyFiles: jest.fn((id: string) => {
      events.push(`delete-files:${id}`);
      return Promise.resolve();
    }),
  };

  const service = new CompaniesService(
    dataSource as never,
    {} as never,
    users as never,
    {} as never,
    {} as never,
    auditLog,
    {} as never,
    authVersions as never,
    files as never,
  );
  return { service, events, manager, authVersions, files };
}

describe('CompaniesService.remove: guards before DROP SCHEMA', () => {
  it('refuses to delete a company that is not archived', async () => {
    const { service, events } = makeService(
      makeCompany({ status: CompanyStatus.ACTIVE }),
      2,
    );
    await expect(service.remove('company-a', 'Acme', ACTOR)).rejects.toThrow(
      'Only an archived company can be permanently deleted.',
    );
    expect(events).toEqual(['rollback']);
  });

  it('refuses when the typed name does not match', async () => {
    const { service, events } = makeService(makeCompany(), 2);
    await expect(service.remove('company-a', 'acme', ACTOR)).rejects.toThrow(
      'Company name confirmation does not match.',
    );
    expect(events).toEqual(['rollback']);
  });

  it('is a 404 for a company that does not exist', async () => {
    const { service, events } = makeService(null);
    await expect(service.remove('missing', 'Acme', ACTOR)).rejects.toThrow(
      NotFoundException,
    );
    expect(events).toEqual(['rollback']);
  });

  // The schema name is interpolated into DDL, so a corrupted row must
  // fail validation rather than run (and the deletes roll back with it).
  it('never runs DROP SCHEMA with an invalid schema name', async () => {
    const { service, events, authVersions, files } = makeService(
      makeCompany({ schemaName: 'tenant_acme"; DROP SCHEMA public; --' }),
      2,
    );
    await expect(service.remove('company-a', 'Acme', ACTOR)).rejects.toThrow();
    expect(events.some((event) => event.startsWith('DROP SCHEMA'))).toBe(false);
    expect(events.at(-1)).toBe('rollback');
    expect(authVersions.publishDeleted).not.toHaveBeenCalled();
    expect(files.deleteCompanyFiles).not.toHaveBeenCalled();
  });

  it('deletes users, the company and its schema in one transaction, then marks the users deleted and clears its files', async () => {
    const { service, events } = makeService(makeCompany(), 2);
    await service.remove('company-a', 'Acme', ACTOR);
    expect(events).toEqual([
      'delete-users',
      'delete-company',
      'DROP SCHEMA "tenant_acme" CASCADE',
      'commit',
      'publish-deleted:2',
      'delete-files:company-a',
    ]);
  });
});

describe('CompaniesService.archive', () => {
  it('ends every session, bumps every user, and publishes after the commit', async () => {
    const { service, events, authVersions } = makeService(
      makeCompany({ status: CompanyStatus.ACTIVE }),
      2,
    );
    const result = await service.archive('company-a', ACTOR);
    expect(result.status).toBe(CompanyStatus.SUSPENDED);
    expect(authVersions.bump).toHaveBeenCalledWith(expect.anything(), {
      companyId: 'company-a',
    });
    expect(events).toEqual(['end-sessions', 'bump', 'commit', 'publish']);
  });

  it('refuses a company that is already archived', async () => {
    const { service, events } = makeService(makeCompany(), 2);
    await expect(service.archive('company-a', ACTOR)).rejects.toThrow(
      BadRequestException,
    );
    expect(events).toEqual(['rollback']);
  });
});

describe('CompaniesService.update: the seat limit (S13)', () => {
  const active = (maxUsers: number) =>
    makeCompany({ status: CompanyStatus.ACTIVE, maxUsers });

  it('refuses to lower the limit below the users the company has', async () => {
    const { service, events } = makeService(active(5), 4);
    await expect(
      service.update('company-a', { maxUsers: 3 }, ACTOR),
    ).rejects.toThrow(
      '"Acme" has 4 users; remove some before lowering the limit to 3.',
    );
    expect(events).toEqual(['rollback']);
  });

  it('lowers the limit to exactly the number of users', async () => {
    const { service, events } = makeService(active(5), 4);
    const result = await service.update('company-a', { maxUsers: 4 }, ACTOR);
    expect(result.maxUsers).toBe(4);
    expect(events).toEqual(['billing', 'commit']);
  });

  // Data from before S13 can already be over its limit; raising it (or
  // saving an unrelated change) must not be blocked by that.
  it('lets an over-limit company raise its limit or change its name', async () => {
    const { service, manager } = makeService(active(2), 5);
    await service.update('company-a', { maxUsers: 3 }, ACTOR);
    await service.update('company-a', { name: 'Acme Ltd' }, ACTOR);
    expect(manager.count).not.toHaveBeenCalled();
  });

  it('writes a billing row only when the plan or the limit changes', async () => {
    const { service, events } = makeService(active(5), 1);
    await service.update('company-a', { name: 'Acme Ltd', maxUsers: 5 }, ACTOR);
    expect(events).toEqual(['commit']);
  });
});
