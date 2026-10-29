import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { In, type EntityManager } from 'typeorm';
import { FREE_PLAN_LIMITS } from '@repo/types/plans';
import { Client } from '../../database/tenant/entities/client.entity';
import { Project } from '../../database/tenant/entities/project.entity';

/**
 * What Free still allows inside a tenant run (docs/subscriptions_planing.md
 * §4b, B12, B13): one client, one project, and only the picked project is
 * editable. Reads `request.subscription` (SubscriptionGuard); a request
 * without one (no company user) is never limited. Call these inside the
 * same `run()` as the write, so the count can't go stale.
 */
@Injectable({ scope: Scope.REQUEST })
export class PlanAccess {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  private get free(): boolean {
    return this.request.subscription?.free ?? false;
  }

  /** 409 `plan_limit` when Free already has its one client / project. */
  async assertCanCreate(
    manager: EntityManager,
    what: 'clients' | 'projects',
  ): Promise<void> {
    if (!this.free) return;
    const max =
      what === 'clients'
        ? FREE_PLAN_LIMITS.maxClients
        : FREE_PLAN_LIMITS.maxProjects;
    const count = await manager.count(what === 'clients' ? Client : Project);
    if (count >= max) {
      throw new ConflictException({
        message: `The Free plan allows ${max} ${what === 'clients' ? 'client' : 'project'}.`,
        code: 'plan_limit',
      });
    }
  }

  /**
   * 403 `project_read_only` for a write to a project Free didn't keep
   * (B13, Q5): only the picked one is editable; with one project or none
   * there's nothing to pick. Viewing and deleting are never refused.
   */
  async assertProjectsEditable(
    manager: EntityManager,
    projectIds: string[],
  ): Promise<void> {
    if (!this.free) return;
    const picked = this.request.subscription?.freeProjectId ?? null;
    const others = [...new Set(projectIds)].filter((id) => id !== picked);
    if (others.length === 0) return;
    if (picked === null && (await manager.count(Project)) <= 1) return;
    // Ids that don't exist are left to the caller's own 404.
    const existing = await manager.count(Project, {
      where: { id: In(others) },
    });
    if (existing === 0) return;
    throw new ForbiddenException({
      message: 'This project is read-only on the Free plan.',
      code: 'project_read_only',
    });
  }
}
