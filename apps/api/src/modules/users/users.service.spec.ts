import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import { UsersService } from './users.service';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import { Company } from '../../database/control-plane/entities/company.entity';
import type { BumpedVersion } from '../auth/auth-version.service';

/**
 * Stability S21: the branch logic of users.service: the super-admin
 * line in update(), the seat limit, and the self-protection guards,
 * against a fake QueryRunner. `events` records the order of commit,
 * rollback and publish, so the tests can check that nothing is published
 * before (or without) a commit.
 */

const ACTOR = 'actor-1';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@acme.local',
    passwordHash: 'hash',
    role: UserRole.COMPANY_ADMIN,
    companyId: 'company-a',
    status: UserStatus.ACTIVE,
    authVersion: 0,
    createdAt: new Date(),
    ...overrides,
  } as User;
}

interface Options {
  /** What `manager.findOne(User, …)` returns, by the email or id asked for. */
  users?: User[];
  /** The company `lockCompanyForSeatCheck` finds. */
  company?: { id: string; name: string; maxUsers: number } | null;
  /** How many users that company already has. */
  seatsUsed?: number;
}

function makeService(options: Options = {}) {
  const events: string[] = [];
  const users = options.users ?? [];
  const findUser = (where: Partial<User>) =>
    users.find(
      (user) =>
        (where.id === undefined || user.id === where.id) &&
        (where.email === undefined || user.email === where.email) &&
        (where.companyId === undefined || user.companyId === where.companyId),
    ) ?? null;

  const manager = {
    findOne: jest.fn(
      (entity: unknown, opts: { where: Partial<User> & { id?: string } }) =>
        Promise.resolve(
          entity === User
            ? findUser(opts.where)
            : entity === Company
              ? { id: opts.where.id, name: 'Acme' }
              : null,
        ),
    ),
    create: jest.fn((_entity: unknown, values: Partial<User>) =>
      makeUser({ id: 'new-user', ...values }),
    ),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    delete: jest.fn(() => Promise.resolve(undefined)),
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
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve(options.company ? [options.company] : []);
      }
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve([{ count: options.seatsUsed ?? 0 }]);
      }
      if (sql.startsWith('DELETE FROM "sessions"')) events.push('end-session');
      return Promise.resolve([]);
    }),
  };
  const dataSource = { createQueryRunner: () => queryRunner };
  const sessions = { findOne: jest.fn(() => Promise.resolve(null)) };
  const companies = {
    findOne: jest.fn(() => Promise.resolve({ name: 'Acme' })),
  };
  const authVersions = {
    bump: jest.fn((): Promise<BumpedVersion[]> => {
      events.push('bump');
      return Promise.resolve([{ userId: 'user-1', version: 1 }]);
    }),
    publish: jest.fn((bumped: BumpedVersion[]) => {
      events.push(`publish:${bumped.length}`);
      return Promise.resolve();
    }),
    publishDeleted: jest.fn(() => {
      events.push('publish-deleted');
      return Promise.resolve();
    }),
  };
  const auditLog = { record: jest.fn(() => Promise.resolve()) };
  const passwordService = { hash: jest.fn(() => Promise.resolve('new-hash')) };

  const service = new UsersService(
    dataSource as never,
    {} as never,
    companies as never,
    sessions as never,
    passwordService as never,
    auditLog,
    authVersions as never,
  );
  return { service, events, queryRunner, manager, authVersions };
}

describe('UsersService.update: the super-admin line', () => {
  const superAdmin = makeUser({
    id: 'super-1',
    role: UserRole.SUPER_ADMIN,
    companyId: null,
  });

  it('refuses to let the actor remove their own super admin access', async () => {
    const self = makeUser({
      id: ACTOR,
      role: UserRole.SUPER_ADMIN,
      companyId: null,
    });
    const { service, events } = makeService({ users: [self] });
    await expect(
      service.update(ACTOR, { role: UserRole.USER }, ACTOR),
    ).rejects.toThrow(ForbiddenException);
    expect(events).toEqual(['rollback']);
  });

  it('refuses to promote a company user to super admin', async () => {
    const { service } = makeService({ users: [makeUser()] });
    await expect(
      service.update(
        'user-1',
        { role: UserRole.SUPER_ADMIN, companyId: null },
        ACTOR,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses to move a super admin into a company', async () => {
    const { service } = makeService({ users: [superAdmin] });
    await expect(
      service.update(
        'super-1',
        { role: UserRole.COMPANY_ADMIN, companyId: 'company-a' },
        ACTOR,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a company on a super admin who stays super admin', async () => {
    const { service } = makeService({ users: [superAdmin] });
    await expect(
      service.update('super-1', { companyId: 'company-a' }, ACTOR),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses to clear the company of a company user', async () => {
    const { service } = makeService({ users: [makeUser()] });
    await expect(
      service.update('user-1', { companyId: null }, ACTOR),
    ).rejects.toThrow(BadRequestException);
  });

  it('is a 404 for a user that does not exist', async () => {
    const { service } = makeService();
    await expect(
      service.update('missing', { role: UserRole.USER }, ACTOR),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('UsersService.update: what a change does to the session', () => {
  it('a role change keeps the session and publishes the bump after the commit', async () => {
    const { service, events, queryRunner } = makeService({
      users: [makeUser()],
    });
    const result = await service.update(
      'user-1',
      { role: UserRole.USER },
      ACTOR,
    );
    expect(result.role).toBe(UserRole.USER);
    expect(events).toEqual(['bump', 'commit', 'publish:1']);
    // Same company: no seat check.
    expect(queryRunner.query).not.toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      expect.anything(),
    );
  });

  it('a company move checks the seat, ends the session and bumps', async () => {
    const { service, events } = makeService({
      users: [makeUser()],
      company: { id: 'company-b', name: 'Beta', maxUsers: 5 },
      seatsUsed: 4,
    });
    const result = await service.update(
      'user-1',
      { companyId: 'company-b' },
      ACTOR,
    );
    expect(result.companyName).toBe('Beta');
    expect(events).toEqual(['bump', 'end-session', 'commit', 'publish:1']);
  });

  it('a company move into a full company is refused and nothing is published', async () => {
    const { service, events, authVersions } = makeService({
      users: [makeUser()],
      company: { id: 'company-b', name: 'Beta', maxUsers: 5 },
      seatsUsed: 5,
    });
    await expect(
      service.update('user-1', { companyId: 'company-b' }, ACTOR),
    ).rejects.toThrow('"Beta" is at its seat limit.');
    expect(events).toEqual(['rollback']);
    expect(authVersions.publish).not.toHaveBeenCalled();
  });

  it('an email-only change bumps nothing', async () => {
    const { service, events } = makeService({ users: [makeUser()] });
    await service.update('user-1', { email: 'renamed@acme.local' }, ACTOR);
    expect(events).toEqual(['commit', 'publish:0']);
  });

  it('refuses an email another user already has (S12)', async () => {
    const other = makeUser({ id: 'user-2', email: 'taken@acme.local' });
    const { service } = makeService({ users: [makeUser(), other] });
    await expect(
      service.update('user-1', { email: 'taken@acme.local' }, ACTOR),
    ).rejects.toThrow('A user with this email already exists.');
  });

  it('accepts a user resending their own email', async () => {
    const { service, events } = makeService({ users: [makeUser()] });
    await service.update('user-1', { email: 'user@acme.local' }, ACTOR);
    expect(events).toEqual(['commit', 'publish:0']);
  });
});

describe('UsersService.create: the seat limit boundary', () => {
  const input = {
    email: 'new@acme.local',
    password: 'Password-123',
    role: UserRole.USER,
    companyId: 'company-a',
  };
  const company = { id: 'company-a', name: 'Acme', maxUsers: 5 };

  it('takes the last free seat', async () => {
    const { service, events } = makeService({ company, seatsUsed: 4 });
    await expect(service.create(input, ACTOR)).resolves.toMatchObject({
      email: 'new@acme.local',
    });
    expect(events).toEqual(['commit']);
  });

  it('refuses once every seat is taken', async () => {
    const { service, events } = makeService({ company, seatsUsed: 5 });
    await expect(service.create(input, ACTOR)).rejects.toThrow(
      '"Acme" is at its seat limit.',
    );
    expect(events).toEqual(['rollback']);
  });

  it('is a 404 for a company that does not exist', async () => {
    const { service } = makeService({ company: null });
    await expect(service.create(input, ACTOR)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('UsersService: self-protection and scoping', () => {
  it('refuses to deactivate your own account', async () => {
    const { service, queryRunner } = makeService();
    await expect(service.deactivate(ACTOR, ACTOR)).rejects.toThrow(
      ForbiddenException,
    );
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('refuses to delete your own account', async () => {
    const { service, queryRunner } = makeService();
    await expect(service.remove(ACTOR, 'me@acme.local', ACTOR)).rejects.toThrow(
      ForbiddenException,
    );
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('refuses a delete whose confirmation email does not match', async () => {
    const { service, manager, events } = makeService({ users: [makeUser()] });
    await expect(
      service.remove('user-1', 'someone-else@acme.local', ACTOR),
    ).rejects.toThrow('Email confirmation does not match.');
    expect(manager.delete).not.toHaveBeenCalled();
    expect(events).toEqual(['rollback']);
  });

  it('marks a deleted user only after the commit', async () => {
    const { service, events } = makeService({ users: [makeUser()] });
    await service.remove('user-1', 'user@acme.local', ACTOR);
    expect(events).toEqual(['commit', 'publish-deleted']);
  });

  // A company admin acting on another company's user: the row is not
  // found, so it's a 404, never a 403 that would confirm the user exists.
  it("a company admin can't reach another company's user", async () => {
    const { service } = makeService({ users: [makeUser()] });
    await expect(
      service.deactivate('user-1', ACTOR, 'company-b'),
    ).rejects.toThrow(NotFoundException);
  });

  it('deactivating ends the session and bumps, then publishes after the commit', async () => {
    const { service, events } = makeService({ users: [makeUser()] });
    const result = await service.deactivate('user-1', ACTOR, 'company-a');
    expect(result.status).toBe(UserStatus.INACTIVE);
    expect(events).toEqual(['end-session', 'bump', 'commit', 'publish:1']);
  });

  it('refuses to deactivate a user who is already inactive', async () => {
    const { service } = makeService({
      users: [makeUser({ status: UserStatus.INACTIVE })],
    });
    await expect(service.deactivate('user-1', ACTOR)).rejects.toThrow(
      'User is already inactive.',
    );
  });
});
