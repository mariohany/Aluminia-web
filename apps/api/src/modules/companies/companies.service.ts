import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type {
  BillingRecordSummary,
  CompanyDetail,
  CompanyListItem,
  CompanySummary,
  CompanyUserSummary,
  CreateCompanyInput,
  UpdateCompanyInput,
} from '@repo/types/companies';
import { FREE_PLAN_LIMITS } from '@repo/types/plans';
import {
  endOfCairoDay,
  type BillingReason,
  type UpdateSubscriptionInput,
} from '@repo/types/subscriptions';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import { Plan } from '../../database/control-plane/entities/plan.entity';
import { toPlanRef } from '../plans/plans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { assertValidSchemaName } from '../../database/tenant/schema-name';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ProjectCountsService } from '../project-counts/project-counts.service';
import { AuthVersionService } from '../auth/auth-version.service';
import { FilesService } from '../files/files.service';
import { rollbackQuietly } from '../../database/rollback';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(BillingRecord)
    private readonly billing: Repository<BillingRecord>,
    private readonly provisioning: TenantProvisioningService,
    private readonly auditLog: AuditLogService,
    private readonly projectCounts: ProjectCountsService,
    private readonly authVersions: AuthVersionService,
    private readonly files: FilesService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async list(): Promise<CompanyListItem[]> {
    const companies = await this.companies.find({
      relations: { plan: true },
      order: { createdAt: 'DESC' },
    });
    if (companies.length === 0) return [];

    const [counts, projectCounts] = await Promise.all([
      this.dataSource
        .createQueryBuilder(User, 'user')
        .select('user.companyId', 'companyId')
        .addSelect('COUNT(*)', 'count')
        .where('user.companyId IS NOT NULL')
        .groupBy('user.companyId')
        .getRawMany<{ companyId: string; count: string }>(),
      this.projectCounts.byCompany(),
    ]);
    const countByCompany = new Map(
      counts.map((row) => [row.companyId, Number(row.count)]),
    );

    return companies.map((company) => ({
      ...toCompanySummary(company, countByCompany.get(company.id) ?? 0),
      // Archived companies aren't counted (null → "—"). An active one
      // missing from a still-cached map was created or reactivated within
      // the cache's 90 s, so 0 is the honest answer for a new one.
      projectCount:
        company.status === CompanyStatus.ACTIVE
          ? (projectCounts.get(company.id) ?? 0)
          : null,
    }));
  }

  async detail(id: string): Promise<CompanyDetail> {
    const company = await this.companies.findOne({
      where: { id },
      relations: { plan: true },
    });
    if (!company) throw new NotFoundException('Company not found.');

    const [users, billing, projectCounts] = await Promise.all([
      this.users.find({
        where: { companyId: id },
        order: { createdAt: 'ASC' },
      }),
      this.billing.find({
        where: { companyId: id },
        relations: { plan: true, actor: true },
        order: { effectiveFrom: 'DESC', createdAt: 'DESC' },
      }),
      this.projectCounts.byCompany(),
    ]);

    return {
      ...toCompanySummary(company, users.length),
      // Same rule as list(): archived → null ("—").
      projectCount:
        company.status === CompanyStatus.ACTIVE
          ? (projectCounts.get(company.id) ?? 0)
          : null,
      schemaName: company.schemaName,
      freeProjectId: company.freeProjectId,
      updatedAt: company.updatedAt.toISOString(),
      users: users.map(toCompanyUserSummary),
      billing: billing.map(toBillingSummary),
    };
  }

  async create(
    input: CreateCompanyInput,
    actorId: string,
  ): Promise<CompanySummary> {
    // A new company starts on Free (B12); Edit subscription sets the rest.
    const { company } = await this.provisioning.provision({
      name: input.name,
      nameAr: input.nameAr,
      admin: input.admin,
    });

    // TenantProvisioningService owns its own transaction end to end and
    // doesn't expose it, so this write sits just outside it: a
    // best-effort follow-up record, not part of the same atomic unit.
    // If provisioning fails nothing happened and there's nothing to log;
    // the narrow risk is a successful provision with a failed log write.
    await this.auditLog.record(this.dataSource.manager, {
      actorUserId: actorId,
      action: 'company.created',
      targetType: 'company',
      targetId: company.id,
      metadata: {
        name: company.name,
        plan: company.plan?.nameEn,
        maxUsers: company.maxUsers,
      },
    });

    return toCompanySummary(company, 1);
  }

  /** The Overview tab: the English and Arabic names (B20). */
  async update(
    id: string,
    input: UpdateCompanyInput,
    actorId: string,
  ): Promise<CompanySummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const company = await queryRunner.manager.findOne(Company, {
        where: { id },
      });
      if (!company) throw new NotFoundException('Company not found.');

      if (input.name !== undefined) company.name = input.name;
      if (input.nameAr !== undefined) company.nameAr = input.nameAr;
      await queryRunner.manager.save(company);

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'company.updated',
        targetType: 'company',
        targetId: company.id,
        metadata: { name: company.name },
      });

      await queryRunner.commitTransaction();
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }
    return this.summary(id);
  }

  /**
   * Edit subscription (B2, `bill-cd-edit-sub`): plan, seat limit, end
   * date, trial, currency, VAT. Seats never go below the company's users
   * on a paid plan (B3). Free is fixed at one seat: one admin stays
   * active and the others are deactivated (B13); a paid plan after Free
   * brings back exactly those (B14). Every change appends a history row.
   */
  async updateSubscription(
    id: string,
    input: UpdateSubscriptionInput,
    actorId: string,
  ): Promise<CompanyDetail> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let bumped: Awaited<
      ReturnType<SubscriptionsService['dropToFree']>
    >['bumped'] = [];

    try {
      const manager = queryRunner.manager;
      // Same row lock as the seat check in UsersService, so a user added
      // at this moment can't slip past the count below.
      const company = await manager.findOne(Company, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!company) throw new NotFoundException('Company not found.');
      const [plan, previous] = await Promise.all([
        manager.findOneOrFail(Plan, { where: { key: input.planKey } }),
        manager.findOneOrFail(Plan, { where: { id: company.planId } }),
      ]);
      const toFree = plan.key === 'free';
      const wasFree = previous.key === 'free';

      // B3 / S13: never below the users (deactivated ones hold a seat).
      // Checked only when the limit goes down or Free ends (its users all
      // come back), so data already over its limit can still be raised.
      if (!toFree && (input.maxUsers < company.maxUsers || wasFree)) {
        const userCount = await manager.count(User, {
          where: { companyId: id },
        });
        if (input.maxUsers < userCount) {
          throw new BadRequestException({
            message: `"${company.name}" has ${userCount} users; remove some before lowering the seat limit to ${input.maxUsers}.`,
            code: 'seats_below_users',
          });
        }
      }

      const next = {
        planId: plan.id,
        maxUsers: toFree ? FREE_PLAN_LIMITS.seats : input.maxUsers,
        endsAt:
          toFree || input.endDate === null
            ? null
            : endOfCairoDay(input.endDate),
        isTrial: !toFree && input.isTrial,
        currency: input.currency,
        vatRate: input.vatRate,
      };

      let deactivated: string[] = [];
      let reactivated: string[] = [];
      if (toFree) {
        const change = await this.subscriptions.dropToFree(
          manager,
          id,
          input.keepAdminId,
        );
        deactivated = change.deactivated;
        bumped = change.bumped;
      } else if (wasFree) {
        reactivated = await this.subscriptions.restoreFromFree(manager, id);
      }

      const changed =
        next.planId !== company.planId ||
        next.maxUsers !== company.maxUsers ||
        next.endsAt?.getTime() !== company.endsAt?.getTime() ||
        next.isTrial !== company.isTrial ||
        next.currency !== company.currency ||
        next.vatRate !== company.vatRate;

      const reason: BillingReason =
        toFree && !wasFree
          ? 'dropped_to_free'
          : next.isTrial && !(company.isTrial && company.planId === plan.id)
            ? 'trial_started'
            : 'edited';

      Object.assign(company, next);
      // A fresh drop to Free asks the admin to pick a project again;
      // leaving Free unlocks every project (B13, B14).
      if (!toFree || !wasFree) company.freeProjectId = null;
      await manager.save(company);

      if (changed || input.note || deactivated.length > 0) {
        await manager.insert(BillingRecord, {
          companyId: id,
          planId: plan.id,
          maxUsers: company.maxUsers,
          endsAt: company.endsAt,
          isTrial: company.isTrial,
          reason,
          notes: input.note || null,
          actorId,
        });
        await this.auditLog.record(manager, {
          actorUserId: actorId,
          action: 'company.subscription_changed',
          targetType: 'company',
          targetId: id,
          metadata: {
            name: company.name,
            plan: plan.nameEn,
            maxUsers: company.maxUsers,
            endsAt: company.endsAt?.toISOString() ?? null,
            isTrial: company.isTrial,
            reason,
            deactivated: deactivated.length,
            reactivated: reactivated.length,
          },
        });
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }
    if (bumped.length > 0) await this.authVersions.publish(bumped);
    return this.detail(id);
  }

  /** Clears the project Free keeps editable; the company admin picks again (Q5). */
  async resetFreeProject(id: string, actorId: string): Promise<CompanyDetail> {
    await this.dataSource.transaction(async (manager) => {
      const company = await manager.findOne(Company, { where: { id } });
      if (!company) throw new NotFoundException('Company not found.');
      if (company.freeProjectId === null) return;
      company.freeProjectId = null;
      await manager.save(company);
      await this.auditLog.record(manager, {
        actorUserId: actorId,
        action: 'company.free_project_reset',
        targetType: 'company',
        targetId: id,
        metadata: { name: company.name },
      });
    });
    return this.detail(id);
  }

  /** A company as the mutation endpoints return it, plan included. */
  private async summary(id: string): Promise<CompanySummary> {
    const [company, userCount] = await Promise.all([
      this.companies.findOneOrFail({
        where: { id },
        relations: { plan: true },
      }),
      this.users.count({ where: { companyId: id } }),
    ]);
    return toCompanySummary(company, userCount);
  }

  async archive(id: string, actorId: string): Promise<CompanySummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const company = await queryRunner.manager.findOne(Company, {
        where: { id },
      });
      if (!company) throw new NotFoundException('Company not found.');
      if (company.status === CompanyStatus.SUSPENDED) {
        throw new BadRequestException('Company is already archived.');
      }

      company.status = CompanyStatus.SUSPENDED;
      await queryRunner.manager.save(company);

      // Logs every user of this company out immediately, not whenever
      // their token happens to expire — the whole point of archiving.
      // Login itself is blocked separately, in AuthService. Raw SQL
      // rather than the query builder: this deletes by a subquery
      // condition on another table, which reads far more plainly this
      // way than through builder chaining.
      await queryRunner.query(
        `DELETE FROM "sessions" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "company_id" = $1)`,
        [id],
      );
      // ...and their access tokens are refused from their next request,
      // on every route, not only tenant-scoped ones (stability S3).
      const bumped = await this.authVersions.bump(queryRunner.manager, {
        companyId: id,
      });

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'company.archived',
        targetType: 'company',
        targetId: company.id,
        metadata: { name: company.name },
      });

      await queryRunner.commitTransaction();
      await this.authVersions.publish(bumped);
      return this.summary(id);
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async reactivate(id: string, actorId: string): Promise<CompanySummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const company = await queryRunner.manager.findOne(Company, {
        where: { id },
      });
      if (!company) throw new NotFoundException('Company not found.');
      if (company.status === CompanyStatus.ACTIVE) {
        throw new BadRequestException('Company is already active.');
      }

      company.status = CompanyStatus.ACTIVE;
      await queryRunner.manager.save(company);

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'company.reactivated',
        targetType: 'company',
        targetId: company.id,
        metadata: { name: company.name },
      });

      await queryRunner.commitTransaction();
      return this.summary(id);
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async remove(
    id: string,
    confirmName: string,
    actorId: string,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const company = await queryRunner.manager.findOne(Company, {
        where: { id },
      });
      if (!company) throw new NotFoundException('Company not found.');
      if (company.status !== CompanyStatus.SUSPENDED) {
        throw new BadRequestException(
          'Only an archived company can be permanently deleted.',
        );
      }
      if (confirmName !== company.name) {
        throw new BadRequestException(
          'Company name confirmation does not match.',
        );
      }

      // users.company_id is ON DELETE RESTRICT (Phase 4) — deletion has
      // to remove them explicitly and in the right order, or Postgres
      // correctly refuses. Their sessions cascade automatically.
      const deletedUserIds = (
        await queryRunner.manager.find(User, {
          where: { companyId: company.id },
          select: { id: true },
        })
      ).map((user) => user.id);
      await queryRunner.manager.delete(User, { companyId: company.id });

      // Written before the company row disappears: the log has to
      // survive the delete it's recording, and target_id is deliberately
      // not a foreign key (see the migration) so it can.
      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'company.deleted',
        targetType: 'company',
        targetId: company.id,
        metadata: {
          name: company.name,
          schemaName: company.schemaName,
        },
      });

      // billing rows cascade automatically (ON DELETE CASCADE).
      await queryRunner.manager.delete(Company, { id: company.id });

      assertValidSchemaName(company.schemaName);
      await queryRunner.query(`DROP SCHEMA "${company.schemaName}" CASCADE`);

      await queryRunner.commitTransaction();
      await this.authVersions.publishDeleted(deletedUserIds);
      // The `files` rows cascaded with the company; the bytes are keyed by
      // company and cleared now, after the commit. Best-effort and logged
      // inside: a leftover blob is harmless, a failed delete must not undo
      // the company delete.
      await this.files.deleteCompanyFiles(company.id);
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

// `company.plan` must be loaded (`relations: { plan: true }`).
function toCompanySummary(company: Company, userCount: number): CompanySummary {
  return {
    id: company.id,
    name: company.name,
    nameAr: company.nameAr,
    status: company.status,
    plan: toPlanRef(company.plan!),
    maxUsers: company.maxUsers,
    endsAt: company.endsAt?.toISOString() ?? null,
    isTrial: company.isTrial,
    currency: company.currency,
    vatRate: company.vatRate,
    userCount,
    createdAt: company.createdAt.toISOString(),
  };
}

function toBillingSummary(record: BillingRecord): BillingRecordSummary {
  return {
    id: record.id,
    plan: toPlanRef(record.plan!),
    maxUsers: record.maxUsers,
    endsAt: record.endsAt?.toISOString() ?? null,
    isTrial: record.isTrial,
    reason: record.reason,
    notes: record.notes,
    actorEmail: record.actor?.email ?? null,
    effectiveFrom: record.effectiveFrom.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

function toCompanyUserSummary(user: User): CompanyUserSummary {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    planDeactivated: user.planDeactivated,
    createdAt: user.createdAt.toISOString(),
  };
}
