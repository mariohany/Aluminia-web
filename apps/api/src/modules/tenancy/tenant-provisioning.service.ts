import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { UserRole } from '@repo/types/auth';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import {
  assertValidSchemaName,
  deriveUniqueSchemaName,
} from '../../database/tenant/schema-name';
import {
  migrationTimestamp,
  tenantMigrations,
} from '../../database/tenant/migrations';
import { TENANT_MIGRATIONS_TABLE } from '../../database/tenant/tenant-data-source';
import { PasswordService } from '../auth/password.service';

export interface ProvisionCompanyInput {
  name: string;
  plan: string;
  maxUsers: number;
  admin: { email: string; password: string };
}

export interface ProvisionCompanyResult {
  company: Company;
  admin: User;
}

@Injectable()
export class TenantProvisioningService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Creates a fully usable manufacturer: control-plane row, its own
   * Postgres schema with every tenant migration applied, an initial
   * billing record, and its first company admin.
   *
   * All of it runs in ONE transaction on ONE connection. That matters
   * more than it looks: Postgres DDL is transactional, so a failure at
   * any point rolls back the `CREATE SCHEMA` too, leaving nothing
   * half-provisioned. It also rules out the obvious-looking alternative
   * of calling `tenantDataSource.runMigrations()` here — that opens a
   * separate connection, which could not see this transaction's
   * uncommitted schema and would deadlock or fail.
   */
  async provision(
    input: ProvisionCompanyInput,
  ): Promise<ProvisionCompanyResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const schemaName = await deriveUniqueSchemaName(input.name, (candidate) =>
        this.schemaNameTaken(queryRunner, candidate),
      );

      const company = await queryRunner.manager.save(
        queryRunner.manager.create(Company, {
          name: input.name,
          plan: input.plan,
          maxUsers: input.maxUsers,
          schemaName,
          status: CompanyStatus.ACTIVE,
        }),
      );

      await queryRunner.manager.save(
        queryRunner.manager.create(BillingRecord, {
          companyId: company.id,
          plan: input.plan,
          maxUsers: input.maxUsers,
          notes: 'Initial plan set at provisioning.',
        }),
      );

      const admin = await queryRunner.manager.save(
        queryRunner.manager.create(User, {
          email: input.admin.email,
          passwordHash: await this.passwordService.hash(input.admin.password),
          role: UserRole.COMPANY_ADMIN,
          companyId: company.id,
          status: UserStatus.ACTIVE,
        }),
      );

      await this.createTenantSchema(queryRunner, schemaName, company);

      await queryRunner.commitTransaction();
      return { company, admin };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async schemaNameTaken(
    queryRunner: QueryRunner,
    candidate: string,
  ): Promise<boolean> {
    // Check both sides: an existing company row, and an existing Postgres
    // schema. They should agree, but a schema left behind by a failed
    // manual operation would otherwise make CREATE SCHEMA blow up.
    const rows = (await queryRunner.query(
      `SELECT EXISTS (
         SELECT 1 FROM companies WHERE schema_name = $1
         UNION ALL
         SELECT 1 FROM information_schema.schemata WHERE schema_name = $1
       ) AS exists`,
      [candidate],
    )) as Array<{ exists: boolean }>;
    return rows[0]?.exists ?? false;
  }

  /**
   * Creates the schema and applies every tenant migration to it, using
   * the caller's transaction.
   */
  private async createTenantSchema(
    queryRunner: QueryRunner,
    schemaName: string,
    company: Company,
  ): Promise<void> {
    // Schema names cannot be bind parameters — they're identifiers, not
    // values — so this is string interpolation into DDL. That is exactly
    // why the name is validated here as well as at derivation.
    assertValidSchemaName(schemaName);
    await queryRunner.query(`CREATE SCHEMA "${schemaName}"`);

    // Scoped to this transaction, so the connection reverts to its normal
    // search_path on commit/rollback and can't leak into a later request.
    await queryRunner.query(`SET LOCAL search_path TO "${schemaName}"`);

    await queryRunner.query(`
      CREATE TABLE "${TENANT_MIGRATIONS_TABLE}" (
        "id" SERIAL NOT NULL,
        "timestamp" bigint NOT NULL,
        "name" character varying NOT NULL,
        CONSTRAINT "PK_${TENANT_MIGRATIONS_TABLE}" PRIMARY KEY ("id")
      )
    `);

    for (const Migration of tenantMigrations) {
      await new Migration().up(queryRunner);
      // Recorded in TypeORM's own format so the migrate-all-tenants
      // runner (which uses TypeORM's runner) correctly sees these as
      // already applied instead of trying to re-run them.
      await queryRunner.query(
        `INSERT INTO "${TENANT_MIGRATIONS_TABLE}" ("timestamp", "name") VALUES ($1, $2)`,
        [migrationTimestamp(Migration), Migration.name],
      );
    }

    await queryRunner.query(
      `INSERT INTO "tenant_info" ("company_id", "company_name") VALUES ($1, $2)`,
      [company.id, company.name],
    );

    await queryRunner.query(`SET LOCAL search_path TO DEFAULT`);
  }
}
