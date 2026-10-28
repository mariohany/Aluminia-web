import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager } from 'typeorm';
import { UserRole } from '@repo/types/auth';
import {
  FREE_PLAN_LIMITS,
  type PlanFeature,
  type PlanKey,
} from '@repo/types/plans';
import { subscriptionState } from '@repo/types/subscriptions';
import { Company } from '../../database/control-plane/entities/company.entity';
import { Plan } from '../../database/control-plane/entities/plan.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import { rollbackQuietly } from '../../database/rollback';
import type { SubscriptionAccess } from './subscription-access';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import {
  AuthVersionService,
  type BumpedVersion,
} from '../auth/auth-version.service';

export interface FreeSeatChange {
  keptUserId: string | null;
  deactivated: string[];
  // Publish after the commit (CLAUDE.md, Auth).
  bumped: BumpedVersion[];
}

/**
 * Who may still use a company when its plan changes
 * (docs/subscriptions_planing.md B13, B14). Both run inside the caller's
 * transaction, which must already hold the company row lock (the seat
 * check in UsersService takes the same lock).
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authVersions: AuthVersionService,
  ) {}

  /**
   * The company's plan right now, for SubscriptionGuard. A trial past its
   * end is settled first (B11: it drops to Free, `endTrial`), so every
   * caller sees the plan the company is really on. Null for an unknown
   * company (the guards after this one refuse it).
   */
  async access(
    companyId: string,
  ): Promise<{ access: SubscriptionAccess; deactivated: string[] } | null> {
    let facts = await this.facts(companyId);
    if (!facts) return null;
    let deactivated: string[] = [];
    if (facts.isTrial && facts.endsAt && facts.endsAt.getTime() < Date.now()) {
      deactivated = await this.endTrial(companyId);
      facts = (await this.facts(companyId))!;
    }
    const state = subscriptionState(facts, new Date());
    const free = state.kind === 'free';
    return {
      access: {
        companyId,
        planKey: facts.planKey,
        state,
        free,
        // Free has none (B12); an expired plan is blocked outright anyway.
        features: free ? [] : facts.features,
        freeProjectId: facts.freeProjectId,
      },
      deactivated,
    };
  }

  private async facts(companyId: string): Promise<{
    planKey: PlanKey;
    features: PlanFeature[];
    endsAt: Date | null;
    isTrial: boolean;
    freeProjectId: string | null;
  } | null> {
    const company = await this.dataSource.getRepository(Company).findOne({
      where: { id: companyId },
      relations: { plan: true },
    });
    if (!company?.plan) return null;
    return {
      planKey: company.plan.key,
      features: company.plan.features,
      endsAt: company.endsAt,
      isTrial: company.isTrial,
      freeProjectId: company.freeProjectId,
    };
  }

  /**
   * A trial ended unpaid (B11, B13): the company drops to Free, the oldest
   * active admin stays and everyone else is deactivated. Idempotent under
   * the company row lock: a second request that sees the same lapse finds
   * it already settled. Returns who was deactivated.
   */
  async endTrial(companyId: string): Promise<string[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let change: FreeSeatChange | null = null;
    try {
      const manager = queryRunner.manager;
      const company = await manager.findOne(Company, {
        where: { id: companyId },
        lock: { mode: 'pessimistic_write' },
      });
      const lapsed =
        company?.isTrial &&
        company.endsAt !== null &&
        company.endsAt.getTime() < Date.now();
      if (company && lapsed) {
        const free = await manager.findOneOrFail(Plan, {
          where: { key: 'free' },
        });
        change = await this.dropToFree(manager, companyId, null);
        Object.assign(company, {
          planId: free.id,
          maxUsers: FREE_PLAN_LIMITS.seats,
          endsAt: null,
          isTrial: false,
          freeProjectId: null,
        });
        await manager.save(company);
        await manager.insert(BillingRecord, {
          companyId,
          planId: free.id,
          maxUsers: FREE_PLAN_LIMITS.seats,
          endsAt: null,
          isTrial: false,
          reason: 'trial_ended',
          notes: null,
          actorId: null,
        });
      }
      await queryRunner.commitTransaction();
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }
    if (change && change.bumped.length > 0) {
      await this.authVersions.publish(change.bumped);
    }
    return change?.deactivated ?? [];
  }

  /**
   * Free has one seat: ONE company admin stays active and every other
   * active user is deactivated with `plan_deactivated`, logged out like a
   * manual deactivate. `keepAdminId` picks the admin (Edit subscription);
   * null keeps the oldest active one (a trial ending). Calling it again on
   * Free with another admin swaps them: the new one comes back only if the
   * drop to Free deactivated them.
   */
  async dropToFree(
    manager: EntityManager,
    companyId: string,
    keepAdminId: string | null,
  ): Promise<FreeSeatChange> {
    const users = await manager.find(User, {
      where: { companyId },
      order: { createdAt: 'ASC' },
    });
    const admins = users.filter((u) => u.role === UserRole.COMPANY_ADMIN);

    let keep: User | undefined;
    if (keepAdminId) {
      keep = admins.find((u) => u.id === keepAdminId);
      const usable =
        keep && (keep.status === UserStatus.ACTIVE || keep.planDeactivated);
      if (!usable) {
        throw new BadRequestException({
          message:
            'Pick an active company admin of this company to stay on Free.',
          code: 'free_admin_invalid',
        });
      }
    } else {
      // A company without an active admin keeps its oldest active user.
      keep =
        admins.find((u) => u.status === UserStatus.ACTIVE) ??
        users.find((u) => u.status === UserStatus.ACTIVE);
    }

    if (keep && keep.status === UserStatus.INACTIVE) {
      keep.status = UserStatus.ACTIVE;
      keep.planDeactivated = false;
      await manager.save(keep);
    }

    const leaving = users.filter(
      (u) => u.id !== keep?.id && u.status === UserStatus.ACTIVE,
    );
    const bumped: BumpedVersion[] = [];
    if (leaving.length > 0) {
      const ids = leaving.map((u) => u.id);
      await manager.update(
        User,
        { id: In(ids) },
        { status: UserStatus.INACTIVE, planDeactivated: true },
      );
      await manager.query(
        `DELETE FROM "sessions" WHERE "user_id" = ANY($1::uuid[])`,
        [ids],
      );
      for (const id of ids) {
        bumped.push(...(await this.authVersions.bump(manager, { userId: id })));
      }
    }

    return {
      keptUserId: keep?.id ?? null,
      deactivated: leaving.map((u) => u.id),
      bumped,
    };
  }

  /**
   * Back on a paid plan: exactly the users the drop to Free deactivated
   * come back. Someone a company admin deactivated stays deactivated.
   * The seat check already counts them (deactivated users hold a seat).
   */
  async restoreFromFree(
    manager: EntityManager,
    companyId: string,
  ): Promise<string[]> {
    const rows: Array<{ id: string }> = await manager.query(
      `UPDATE "users" SET "status" = 'active', "plan_deactivated" = false, "updated_at" = now()
       WHERE "company_id" = $1 AND "plan_deactivated" RETURNING "id"`,
      [companyId],
    );
    return rows.map((row) => row.id);
  }
}
