import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first migration in the TENANT track — runs once inside every
 * company's own schema, never against the control-plane's `public`.
 *
 * Note the deliberate absence of a schema prefix on the table name: the
 * DataSource this runs under sets `schema`, so Postgres resolves
 * unqualified names into the right tenant schema. Hardcoding a schema
 * name here would defeat the entire point of the track.
 */
export class InitialTenantSchema1785971048351 implements MigrationInterface {
  name = 'InitialTenantSchema1785971048351';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenant_info" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "company_name" varchar(255) NOT NULL,
        "provisioned_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tenant_info_company_id" UNIQUE ("company_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tenant_info"`);
  }
}
