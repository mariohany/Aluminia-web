import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Repository } from 'typeorm';
import type { Request } from 'express';
import { TenantGuard } from './tenant.guard';
import {
  Company,
  CompanyStatus,
} from '../../../database/control-plane/entities/company.entity';

// Plain fakes, matching the style of roles.guard.spec.ts and
// auth.service.spec.ts — this guard's logic is a handful of branches
// over a repository lookup, not something that needs a DI container to
// exercise.

function makeRequest(
  companyId: string | null | undefined,
): Pick<Request, 'user' | 'tenant'> & { log?: undefined } {
  return {
    user:
      companyId === undefined
        ? undefined
        : ({ companyId } as unknown as Request['user']),
    tenant: undefined,
    log: undefined,
  };
}

function makeContext(
  request: ReturnType<typeof makeRequest>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeReflector(tenantScoped: boolean | undefined): Reflector {
  return { getAllAndOverride: () => tenantScoped } as unknown as Reflector;
}

function makeGuard(tenantScoped: boolean | undefined, company: Company | null) {
  const companies = { findOne: jest.fn().mockResolvedValue(company) };
  const guard = new TenantGuard(
    makeReflector(tenantScoped),
    companies as unknown as Repository<Company>,
  );
  return { guard, companies };
}

const activeCompany = {
  id: 'company-1',
  name: 'Acme Windows',
  status: CompanyStatus.ACTIVE,
  schemaName: 'tenant_acme_windows',
} as Company;

describe('TenantGuard', () => {
  it('leaves non-tenant-scoped routes alone entirely', async () => {
    const { guard, companies } = makeGuard(undefined, null);
    const request = makeRequest(undefined);

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(companies.findOne).not.toHaveBeenCalled();
    expect(request.tenant).toBeUndefined();
  });

  it('rejects a super admin (no companyId) on a tenant-scoped route', async () => {
    const { guard } = makeGuard(true, null);
    const request = makeRequest(null);

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a companyId that matches no company row', async () => {
    const { guard } = makeGuard(true, null);
    const request = makeRequest('ghost-company');

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an archived company, even with a currently-valid token', async () => {
    const archived = {
      ...activeCompany,
      status: CompanyStatus.SUSPENDED,
    } as Company;
    const { guard } = makeGuard(true, archived);
    const request = makeRequest(archived.id);

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('resolves an active company and stashes it on the request', async () => {
    const { guard } = makeGuard(true, activeCompany);
    const request = makeRequest(activeCompany.id);

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.tenant).toEqual({
      companyId: activeCompany.id,
      companyName: activeCompany.name,
      schemaName: activeCompany.schemaName,
    });
  });

  it('refuses to run even if a stored schema name were somehow invalid', async () => {
    const corrupted = {
      ...activeCompany,
      schemaName: 'not_a_tenant_schema',
    };
    const { guard } = makeGuard(true, corrupted);
    const request = makeRequest(corrupted.id);

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      /unsafe schema name/i,
    );
    expect(request.tenant).toBeUndefined();
  });
});
