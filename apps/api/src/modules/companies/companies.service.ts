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
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
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
  ) {}

  async list(): Promise<CompanyListItem[]> {
    const companies = await this.companies.find({
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
    const company = await this.companies.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Company not found.');

    const [users, billing, projectCounts] = await Promise.all([
      this.users.find({
        where: { companyId: id },
        order: { createdAt: 'ASC' },
      }),
      this.billing.find({
        where: { companyId: id },
        order: { effectiveFrom: 'DESC' },
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
      updatedAt: company.updatedAt.toISOString(),
      users: users.map(toCompanyUserSummary),
      billing: billing.map(toBillingSummary),
    };
  }

  async create(
    input: CreateCompanyInput,
    actorId: string,
  ): Promise<CompanySummary> {
    const { company } = await this.provisioning.provision(input);

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
        plan: company.plan,
        maxUsers: company.maxUsers,
      },
    });

    return toCompanySummary(company, 1);
  }

  async update(
    id: string,
    input: UpdateCompanyInput,
    actorId: string,
  ): Promise<CompanySummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Locked so a user created at the same moment (users.service takes
      // the same row lock for its seat check) can't slip in between the
      // count below and the save.
      const company = await queryRunner.manager.findOne(Company, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!company) throw new NotFoundException('Company not found.');

      // Stability S13: the limit never drops below the users the company
      // already has (deactivated ones still hold a seat, as in the seat
      // check), so nobody is left "5 of 2 seats".
      if (input.maxUsers !== undefined && input.maxUsers < company.maxUsers) {
        const userCount = await queryRunner.manager.count(User, {
          where: { companyId: id },
        });
        if (input.maxUsers < userCount) {
          throw new BadRequestException(
            `"${company.name}" has ${userCount} users; remove some before lowering the limit to ${input.maxUsers}.`,
          );
        }
      }

      const planOrSeatsChanged =
        (input.plan !== undefined && input.plan !== company.plan) ||
        (input.maxUsers !== undefined && input.maxUsers !== company.maxUsers);

      if (input.name !== undefined) company.name = input.name;
      if (input.plan !== undefined) company.plan = input.plan;
      if (input.maxUsers !== undefined) company.maxUsers = input.maxUsers;
      await queryRunner.manager.save(company);

      // Append-only: a plan/seat change writes a new row rather than
      // mutating history, so the billing timeline stays auditable.
      if (planOrSeatsChanged) {
        await queryRunner.manager.insert(BillingRecord, {
          companyId: company.id,
          plan: company.plan,
          maxUsers: company.maxUsers,
          notes: 'Updated by super admin.',
        });
      }

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: planOrSeatsChanged ? 'company.plan_changed' : 'company.updated',
        targetType: 'company',
        targetId: company.id,
        metadata: {
          name: company.name,
          plan: company.plan,
          maxUsers: company.maxUsers,
        },
      });

      await queryRunner.commitTransaction();
      const userCount = await this.users.count({ where: { companyId: id } });
      return toCompanySummary(company, userCount);
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }
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
      const userCount = await this.users.count({ where: { companyId: id } });
      return toCompanySummary(company, userCount);
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
      const userCount = await this.users.count({ where: { companyId: id } });
      return toCompanySummary(company, userCount);
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
          plan: company.plan,
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

function toCompanySummary(company: Company, userCount: number): CompanySummary {
  return {
    id: company.id,
    name: company.name,
    status: company.status,
    plan: company.plan,
    maxUsers: company.maxUsers,
    userCount,
    createdAt: company.createdAt.toISOString(),
  };
}

function toBillingSummary(record: BillingRecord): BillingRecordSummary {
  return {
    id: record.id,
    plan: record.plan,
    maxUsers: record.maxUsers,
    effectiveFrom: record.effectiveFrom.toISOString(),
    notes: record.notes,
    createdAt: record.createdAt.toISOString(),
  };
}

function toCompanyUserSummary(user: User): CompanyUserSummary {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
