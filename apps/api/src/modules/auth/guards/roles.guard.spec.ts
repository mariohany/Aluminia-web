import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(userRole: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: userRole ? { role: userRole } : undefined }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeReflector(metadata: string[] | undefined): Reflector {
  return { getAllAndOverride: () => metadata } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no @Roles() is set', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext('user'))).toBe(true);
  });

  it('allows any authenticated user when @Roles() is empty', () => {
    const guard = new RolesGuard(makeReflector([]));
    expect(guard.canActivate(makeContext('user'))).toBe(true);
  });

  it('allows a user whose role is in the required list', () => {
    const guard = new RolesGuard(makeReflector(['super_admin']));
    expect(guard.canActivate(makeContext('super_admin'))).toBe(true);
  });

  it('rejects a user whose role is not in the required list', () => {
    const guard = new RolesGuard(makeReflector(['super_admin']));
    expect(() => guard.canActivate(makeContext('company_admin'))).toThrow(ForbiddenException);
  });

  it('rejects a request with no user on it, rather than defaulting to allow', () => {
    const guard = new RolesGuard(makeReflector(['super_admin']));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
