import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { FREE_PLAN_LIMITS } from '@repo/types/plans';
import type { CompanySubscription } from '@repo/types/subscriptions';
import { Company } from '../../database/control-plane/entities/company.entity';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import { Client } from '../../database/tenant/entities/client.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { toPlanRef } from '../plans/plans.service';
import type { SubscriptionAccess } from './subscription-access';

/** The workspace's view of its own subscription (§7b) and the Free pick (B13). */
@Injectable()
export class CompanySubscriptionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  async get(access: SubscriptionAccess): Promise<CompanySubscription> {
    const company = await this.dataSource.getRepository(Company).findOneOrFail({
      where: { id: access.companyId },
      relations: { plan: true },
    });
    const [counts, seatsUsed, activeUsers] = await Promise.all([
      this.tenantContext.run(async (manager) => ({
        clients: await manager.count(Client),
        projects: await manager.count(Project),
      })),
      this.dataSource
        .getRepository(User)
        .count({ where: { companyId: access.companyId } }),
      this.dataSource.getRepository(User).count({
        where: { companyId: access.companyId, status: UserStatus.ACTIVE },
      }),
    ]);
    return {
      state: access.state,
      plan: toPlanRef(company.plan!),
      features: access.features,
      limits: access.free
        ? {
            clients: FREE_PLAN_LIMITS.maxClients,
            projects: FREE_PLAN_LIMITS.maxProjects,
          }
        : { clients: null, projects: null },
      counts,
      maxUsers: company.maxUsers,
      seatsUsed,
      activeUsers,
      currency: company.currency,
      freeProjectId: company.freeProjectId,
      needsProjectPick:
        access.free && company.freeProjectId === null && counts.projects > 1,
    };
  }

  /**
   * The company admin picks the one project that stays editable on Free
   * (B13). Once: after that only the super admin can reset it (Q5).
   */
  async pickFreeProject(
    access: SubscriptionAccess,
    projectId: string,
  ): Promise<CompanySubscription> {
    if (!access.free) {
      throw new ConflictException({
        message: 'Only a company on the Free plan picks a project.',
        code: 'not_on_free',
      });
    }
    const exists = await this.tenantContext.run((manager) =>
      manager.exists(Project, { where: { id: projectId } }),
    );
    if (!exists) throw new NotFoundException('Project not found.');

    const result = await this.dataSource
      .createQueryBuilder()
      .update(Company)
      .set({ freeProjectId: projectId })
      .where('id = :id AND free_project_id IS NULL', { id: access.companyId })
      .execute();
    if (result.affected === 0) {
      throw new ConflictException({
        message:
          'The editable project is already picked; only the platform admin can change it.',
        code: 'free_project_picked',
      });
    }
    return this.get({ ...access, freeProjectId: projectId });
  }
}

export function subscriptionOf(request: Request): SubscriptionAccess {
  // SubscriptionGuard sets it for every company user; these routes are
  // company-only (@Roles), so it is always there.
  return request.subscription!;
}
