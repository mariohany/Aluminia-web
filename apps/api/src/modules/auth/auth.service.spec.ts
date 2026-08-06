import { UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { User, UserStatus } from '../../database/control-plane/entities/user.entity';
import { Company, CompanyStatus } from '../../database/control-plane/entities/company.entity';
import { UserRole } from '@repo/types/auth';

// Plain fakes rather than @nestjs/testing's TestingModule — AuthService
// takes plain constructor params, so this is enough to isolate the one
// thing under test (the company-status check) without a DI container.
function makeService(options: { user: User | null; company: Company | null }) {
  const usersRepo = { findOne: jest.fn().mockResolvedValue(options.user) };
  const sessionsRepo = { upsert: jest.fn().mockResolvedValue(undefined) };
  const companiesRepo = { findOne: jest.fn().mockResolvedValue(options.company) };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-access-token') };
  const passwordService = { verify: jest.fn().mockResolvedValue(true) };
  const config = { get: jest.fn().mockReturnValue('7d') };

  const service = new AuthService(
    usersRepo as unknown as Repository<User>,
    sessionsRepo as unknown as Repository<import('../../database/control-plane/entities/session.entity').Session>,
    companiesRepo as unknown as Repository<Company>,
    jwtService as never,
    passwordService as never,
    config as never,
  );

  return { service, usersRepo, sessionsRepo, companiesRepo };
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
