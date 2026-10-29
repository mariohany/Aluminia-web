import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import type { BumpedVersion } from '../auth/auth-version.service';
import type { Plan } from '../../database/control-plane/entities/plan.entity';
import type { UpdateSubscriptionInput } from '@repo/types/subscriptions';

/**
 * Stability S21: the guards in front of companies.service's destructive
 * operations (above all, that only an archived company is ever
 * dropped) and the seat-limit rule on update (S13), against a fake
 * QueryRunner. `events` records the order of what happened, so the
 * tests can check that the schema is never dropped and nothing is
 * published unless the transaction commits.
 */

const ACTOR = 'actor-1';

const PLANS: Record<string, Plan> = Object.fromEntries(
  (['free', 'pro'] as const).map((key) => [
    key,
    {
      id: `plan-${key}`,
      key,
      nameEn: key,
      nameAr: key,
      seats: key === 'free' ? 1 : 5,
      monthlyEgp: null,
      annualEgp: null,
      features: [],
      position: 0,
      updatedAt: new Date(),
    },
  ]),
);

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-a',
    name: 'Acme',
    schemaName: 'tenant_acme',
    status: CompanyStatus.SUSPENDED,
    nameAr: null,
    planId: 'plan-pro',
    maxUsers: 5,
    endsAt: new Date('2027-01-16T21:59:59Z'),
    isTrial: false,
    currency: 'EGP',
    vatRate: 14,
    freeProjectId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(company: Company | null, userCount = 0) {
  const events: string[] = [];
  const planOf = (where: { key?: string; id?: string }) =>
    Object.values(PLANS).find((p) => p.key === where.key || p.id === where.id);
  const manager = {
    findOne: jest.fn(() => Promise.resolve(company)),
    findOneOrFail: jest.fn((_entity: unknown, options: { where: object }) =>
      Promise.resolve(planOf(options.where)),
    ),
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
  const users = {
    count: jest.fn(() => Promise.resolve(userCount)),
    find: jest.fn(() => Promise.resolve([])),
  };
  const withPlan = () =>
    company && { ...company, plan: planOf({ id: company.planId }) };
  const companies = {
    findOne: jest.fn(() => Promise.resolve(withPlan())),
    findOneOrFail: jest.fn(() => Promise.resolve(withPlan())),
  };
  const billing = { find: jest.fn(() => Promise.resolve([])) };
  const projectCounts = {
    byCompany: jest.fn(() => Promise.resolve(new Map())),
  };
  const subscriptions = {
    dropToFree: jest.fn(() => {
      events.push('drop-to-free');
      return Promise.resolve({
        keptUserId: 'user-0',
        deactivated: ['user-1'],
        bumped: [{ userId: 'user-1', version: 2 }],
      });
    }),
    restoreFromFree: jest.fn(() => {
      events.push('restore-from-free');
      return Promise.resolve(['user-1']);
    }),
  };
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
    companies as never,
    users as never,
    billing as never,
    {} as never,
    auditLog,
    projectCounts as never,
    authVersions as never,
    files as never,
    subscriptions as never,
  );
  return { service, events, manager, authVersions, files, subscriptions };
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

describe('CompaniesService.updateSubscription', () => {
  const active = (overrides: Partial<Company> = {}) =>
    makeCompany({ status: CompanyStatus.ACTIVE, ...overrides });
  const input = (
    overrides: Partial<UpdateSubscriptionInput> = {},
  ): UpdateSubscriptionInput => ({
    planKey: 'pro',
    maxUsers: 5,
    endDate: '2027-01-16',
    isTrial: false,
    currency: 'EGP',
    vatRate: 14,
    note: null,
    keepAdminId: null,
    ...overrides,
  });

  // B3 / S13: seats never go below the company's users.
  it('refuses a seat limit below the users the company has', async () => {
    const { service, events } = makeService(active(), 4);
    await expect(
      service.updateSubscription('company-a', input({ maxUsers: 3 }), ACTOR),
    ).rejects.toThrow(
      '"Acme" has 4 users; remove some before lowering the seat limit to 3.',
    );
    expect(events).toEqual(['rollback']);
  });

  it('lowers the limit to exactly the number of users', async () => {
    const { service, events } = makeService(active(), 4);
    await service.updateSubscription(
      'company-a',
      input({ maxUsers: 4 }),
      ACTOR,
    );
    expect(events).toEqual(['billing', 'commit']);
  });

  // Data from before S13 can already be over its limit; raising it must
  // not be blocked by that.
  it('lets an over-limit company raise its limit', async () => {
    const { service, manager } = makeService(active({ maxUsers: 2 }), 5);
    await service.updateSubscription(
      'company-a',
      input({ maxUsers: 3 }),
      ACTOR,
    );
    expect(manager.count).not.toHaveBeenCalled();
  });

  it('writes no history when nothing changed', async () => {
    const { service, events } = makeService(active(), 1);
    await service.updateSubscription('company-a', input(), ACTOR);
    expect(events).toEqual(['commit']);
  });

  it('writes a history row for a note alone', async () => {
    const { service, events } = makeService(active(), 1);
    await service.updateSubscription(
      'company-a',
      input({ note: 'Asked for a call' }),
      ACTOR,
    );
    expect(events).toEqual(['billing', 'commit']);
  });

  // B13: one admin stays, the rest are deactivated and logged out after
  // the commit; Free is one seat whatever the input says.
  it('drops to Free keeping the picked admin and publishes after the commit', async () => {
    const { service, events, manager, subscriptions } = makeService(
      active(),
      3,
    );
    await service.updateSubscription(
      'company-a',
      input({
        planKey: 'free',
        maxUsers: 5,
        endDate: null,
        keepAdminId: 'u-2',
      }),
      ACTOR,
    );
    expect(subscriptions.dropToFree).toHaveBeenCalledWith(
      manager,
      'company-a',
      'u-2',
    );
    expect(events).toEqual(['drop-to-free', 'billing', 'commit', 'publish']);
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'plan-free',
        maxUsers: 1,
        endsAt: null,
        isTrial: false,
      }),
    );
    expect(manager.insert).toHaveBeenCalledWith(
      BillingRecord,
      expect.objectContaining({ reason: 'dropped_to_free', actorId: ACTOR }),
    );
  });

  // B14: leaving Free brings back exactly who it deactivated, and every
  // one of them needs a seat.
  it('restores the users Free deactivated, after checking their seats', async () => {
    const free = active({ planId: 'plan-free', maxUsers: 1, endsAt: null });
    const refused = makeService(free, 4);
    await expect(
      refused.service.updateSubscription(
        'company-a',
        input({ maxUsers: 3 }),
        ACTOR,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(refused.subscriptions.restoreFromFree).not.toHaveBeenCalled();

    const { service, events } = makeService(free, 4);
    await service.updateSubscription(
      'company-a',
      input({ maxUsers: 4 }),
      ACTOR,
    );
    expect(events).toEqual(['restore-from-free', 'billing', 'commit']);
  });

  it('starts a trial on a paid plan', async () => {
    const { service, manager } = makeService(active(), 1);
    await service.updateSubscription(
      'company-a',
      input({ isTrial: true, endDate: '2026-11-11' }),
      ACTOR,
    );
    expect(manager.insert).toHaveBeenCalledWith(
      BillingRecord,
      expect.objectContaining({ reason: 'trial_started', isTrial: true }),
    );
  });
});
