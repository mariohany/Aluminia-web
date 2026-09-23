import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { User, UserStatus } from '../../database/control-plane/entities/user.entity';
import { Company, CompanyStatus } from '../../database/control-plane/entities/company.entity';
import { UserRole } from '@repo/types/auth';
import { Session } from '../../database/control-plane/entities/session.entity';
import { REFRESH_GRACE_DEPTH, REFRESH_GRACE_MS } from './auth.constants';

// Plain fakes rather than @nestjs/testing's TestingModule — AuthService
// takes plain constructor params, so this is enough to isolate the one
// thing under test (the company-status check) without a DI container.
function makeService(options: {
  user: User | null;
  company: Company | null;
  session?: Session | null;
}) {
  const usersRepo = { findOne: jest.fn().mockResolvedValue(options.user) };
  // `refresh` does all of its work through the session repository's
  // EntityManager, inside one transaction — the fake runs the callback
  // straight through against itself.
  const session = options.session ?? null;
  // Faithful enough to exercise both lookups the service does: the
  // straight hit on the current hash, and the jsonb fallback that finds
  // a tab one rotation behind.
  const manager = {
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn((entity: unknown, opts: { where: { refreshTokenHash?: string } }) => {
      if (entity !== Session) return Promise.resolve(options.user);
      const hit = session && session.refreshTokenHash === opts.where.refreshTokenHash;
      return Promise.resolve(hit ? session : null);
    }),
    createQueryBuilder: jest.fn(() => {
      let probeHash: string | null = null;
      const builder = {
        setLock: () => builder,
        where: (_sql: string, params: { probe: string }) => {
          probeHash = (JSON.parse(params.probe) as { hash: string }[])[0].hash;
          return builder;
        },
        getOne: () =>
          Promise.resolve(
            session?.graceTokens?.some((token) => token.hash === probeHash)
              ? session
              : null,
          ),
      };
      return builder;
    }),
    transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
      cb(manager as unknown as EntityManager),
    ),
  };
  const sessionsRepo = { upsert: jest.fn().mockResolvedValue(undefined), manager };
  const companiesRepo = { findOne: jest.fn().mockResolvedValue(options.company) };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-access-token') };
  const passwordService = { verify: jest.fn().mockResolvedValue(true) };
  const config = { get: jest.fn().mockReturnValue('30d') };

  const service = new AuthService(
    usersRepo as unknown as Repository<User>,
    sessionsRepo as unknown as Repository<Session>,
    companiesRepo as unknown as Repository<Company>,
    jwtService as never,
    passwordService as never,
    config as never,
  );

  return { service, usersRepo, sessionsRepo, companiesRepo, manager };
}

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'user-1',
    refreshTokenHash: hashToken('current-token'),
    graceTokens: [],
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  } as Session;
}

const companyScopedUser = {
  id: 'user-1',
  email: 'admin@acme.local',
  passwordHash: 'hash',
  status: UserStatus.ACTIVE,
  companyId: 'company-1',
  role: UserRole.COMPANY_ADMIN,
} as User;

const superAdminUser = {
  id: 'user-2',
  email: 'admin@aluminia.local',
  passwordHash: 'hash',
  status: UserStatus.ACTIVE,
  companyId: null,
  role: UserRole.SUPER_ADMIN,
} as User;

describe('AuthService.login — archived company blocks login', () => {
  it('rejects login for a user whose company is suspended, even with correct credentials', async () => {
    const { service } = makeService({
      user: companyScopedUser,
      company: { id: 'company-1', status: CompanyStatus.SUSPENDED } as Company,
    });

    await expect(service.login('admin@acme.local', 'correct-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects login when the company row is missing entirely (fail closed)', async () => {
    const { service } = makeService({ user: companyScopedUser, company: null });

    await expect(service.login('admin@acme.local', 'correct-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('allows login for a user whose company is active', async () => {
    const { service } = makeService({
      user: companyScopedUser,
      company: { id: 'company-1', status: CompanyStatus.ACTIVE } as Company,
    });

    await expect(service.login('admin@acme.local', 'correct-password')).resolves.toMatchObject({
      user: companyScopedUser,
    });
  });

  it('skips the company check entirely for a super admin (no companyId)', async () => {
    const { service, companiesRepo } = makeService({ user: superAdminUser, company: null });

    await expect(service.login('admin@aluminia.local', 'correct-password')).resolves.toMatchObject(
      { user: superAdminUser },
    );
    expect(companiesRepo.findOne).not.toHaveBeenCalled();
  });
});

// The bug these cover: the refresh token rotates on every call and the
// old one used to die instantly, so two page loads refreshing at the
// same moment (Chrome restoring several tabs) left one browser holding a
// token the session row had already replaced — straight back to the
// login screen. The rotated-away token now stays valid for
// REFRESH_GRACE_MS.
describe('AuthService.refresh — rotation grace window', () => {
  it('accepts the current token and keeps it usable as the grace token', async () => {
    const session = makeSession();
    const { service, manager } = makeService({
      user: companyScopedUser,
      company: null,
      session,
    });

    await expect(service.refresh('current-token')).resolves.toMatchObject({
      user: companyScopedUser,
    });

    const written = manager.upsert.mock.calls[0][1] as Session;
    expect(written.graceTokens[0].hash).toBe(hashToken('current-token'));
    expect(new Date(written.graceTokens[0].expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Sliding expiry: a session in daily use never reaches its cap.
    expect(written.expiresAt.getTime()).toBeGreaterThan(session.expiresAt.getTime() - 1000);
  });

  it('accepts the token it just rotated away, inside the grace window', async () => {
    const session = makeSession({
      refreshTokenHash: hashToken('rotated-in'),
      graceTokens: [
        {
          hash: hashToken('rotated-out'),
          expiresAt: new Date(Date.now() + REFRESH_GRACE_MS).toISOString(),
        },
      ],
    });
    const { service, manager } = makeService({
      user: companyScopedUser,
      company: null,
      session,
    });

    await expect(service.refresh('rotated-out')).resolves.toMatchObject({
      user: companyScopedUser,
    });

    // The token that tab still holds stays valid too — this is what
    // lets a third and fourth tab in the same burst through.
    const written = manager.upsert.mock.calls[0][1] as Session;
    expect(written.graceTokens.map((token) => token.hash)).toEqual([
      hashToken('rotated-in'),
      hashToken('rotated-out'),
    ]);
  });

  it('keeps at most REFRESH_GRACE_DEPTH rotated-away tokens', async () => {
    const session = makeSession({
      graceTokens: Array.from({ length: REFRESH_GRACE_DEPTH }, (_, i) => ({
        hash: hashToken(`old-${i}`),
        expiresAt: new Date(Date.now() + REFRESH_GRACE_MS).toISOString(),
      })),
    });
    const { service, manager } = makeService({
      user: companyScopedUser,
      company: null,
      session,
    });

    await service.refresh('current-token');

    const written = manager.upsert.mock.calls[0][1] as Session;
    expect(written.graceTokens).toHaveLength(REFRESH_GRACE_DEPTH);
    expect(written.graceTokens[0].hash).toBe(hashToken('current-token'));
    expect(written.graceTokens.at(-1)!.hash).toBe(
      hashToken(`old-${REFRESH_GRACE_DEPTH - 2}`),
    );
  });

  it('refuses the rotated-away token once the grace window has lapsed — without killing the session', async () => {
    const session = makeSession({
      refreshTokenHash: hashToken('rotated-in'),
      graceTokens: [
        { hash: hashToken('rotated-out'), expiresAt: new Date(Date.now() - 1).toISOString() },
      ],
    });
    const { service, manager } = makeService({
      user: companyScopedUser,
      company: null,
      session,
    });

    await expect(service.refresh('rotated-out')).rejects.toThrow(UnauthorizedException);
    // The legitimate holder of `rotated-in` stays logged in.
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('deletes a session that has passed its absolute expiry', async () => {
    const session = makeSession({ expiresAt: new Date(Date.now() - 1) });
    const { service, manager } = makeService({
      user: companyScopedUser,
      company: null,
      session,
    });

    await expect(service.refresh('current-token')).rejects.toThrow(UnauthorizedException);
    expect(manager.delete).toHaveBeenCalled();
  });
});

describe('AuthService.login — grace token', () => {
  it('clears any grace token from the session it replaces', async () => {
    const { service, manager } = makeService({
      user: superAdminUser,
      company: null,
      session: makeSession({
        graceTokens: [
          {
            hash: hashToken('stale'),
            expiresAt: new Date(Date.now() + REFRESH_GRACE_MS).toISOString(),
          },
        ],
      }),
    });

    await service.login('admin@aluminia.local', 'correct-password');

    const written = manager.upsert.mock.calls[0][1] as Session;
    expect(written.graceTokens).toEqual([]);
  });
});
