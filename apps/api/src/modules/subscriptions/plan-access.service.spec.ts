import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { PlanAccess } from './plan-access.service';
import type { SubscriptionAccess } from './subscription-access';

// Free's limits and read-only projects (docs/subscriptions_planing.md
// B12, B13, Q5), as window create / update / move and project writes
// call them.
function access(overrides: Partial<SubscriptionAccess> = {}) {
  return {
    subscription: {
      companyId: 'c',
      planKey: 'free',
      state: { kind: 'free' },
      free: true,
      features: [],
      freeProjectId: null,
      ...overrides,
    },
  } as unknown as Request;
}

function manager(projects: string[], clients = 0) {
  return {
    count: jest.fn(
      (entity: { name: string }, options?: { where: { id: unknown } }) => {
        if (entity.name === 'Client') return Promise.resolve(clients);
        if (!options) return Promise.resolve(projects.length);
        const ids = (options.where.id as { _value: string[] })._value;
        return Promise.resolve(
          ids.filter((id) => projects.includes(id)).length,
        );
      },
    ),
  } as unknown as EntityManager;
}

describe('PlanAccess', () => {
  it('never limits a paid plan', async () => {
    const plan = new PlanAccess(access({ free: false }));
    await expect(
      plan.assertCanCreate(manager(['a', 'b'], 3), 'projects'),
    ).resolves.toBeUndefined();
    await expect(
      plan.assertProjectsEditable(manager(['a', 'b']), ['b']),
    ).resolves.toBeUndefined();
  });

  it('allows one client and one project on Free', async () => {
    const plan = new PlanAccess(access());
    await expect(
      plan.assertCanCreate(manager([], 0), 'clients'),
    ).resolves.toBeUndefined();
    await expect(
      plan.assertCanCreate(manager([], 1), 'clients'),
    ).rejects.toThrow(ConflictException);
    await expect(
      plan.assertCanCreate(manager(['a']), 'projects'),
    ).rejects.toThrow(ConflictException);
  });

  it('keeps everything editable with one project and no pick', async () => {
    const plan = new PlanAccess(access());
    await expect(
      plan.assertProjectsEditable(manager(['a']), ['a']),
    ).resolves.toBeUndefined();
  });

  it('refuses every project but the picked one, a move from one included', async () => {
    const plan = new PlanAccess(access({ freeProjectId: 'a' }));
    const projects = manager(['a', 'b']);
    await expect(
      plan.assertProjectsEditable(projects, ['a', 'a']),
    ).resolves.toBeUndefined();
    // Moving b's window into a: b is read-only, so it's refused.
    await expect(
      plan.assertProjectsEditable(projects, ['a', 'b']),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses every project while more than one waits for the pick', async () => {
    const plan = new PlanAccess(access());
    await expect(
      plan.assertProjectsEditable(manager(['a', 'b']), ['a']),
    ).rejects.toThrow(ForbiddenException);
  });
});
