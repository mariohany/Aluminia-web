import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialControlPlaneSchema1785963020883 implements MigrationInterface {
  name = 'InitialControlPlaneSchema1785963020883';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "company_status" AS ENUM ('active', 'suspended')`,
    );
    await queryRunner.query(
      `CREATE TYPE "user_role" AS ENUM ('super_admin', 'company_admin', 'user')`,
    );
    await queryRunner.query(
      `CREATE TYPE "user_status" AS ENUM ('active', 'inactive')`,
    );

    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "status" "company_status" NOT NULL DEFAULT 'active',
        "plan" varchar(100) NOT NULL,
        "max_users" integer NOT NULL,
        "schema_name" varchar(63) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_companies_schema_name" UNIQUE ("schema_name"),
        CONSTRAINT "CK_companies_max_users_positive" CHECK ("max_users" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "role" "user_role" NOT NULL,
        "company_id" uuid,
        "status" "user_status" NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "FK_users_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_users_super_admin_has_no_company" CHECK (
          ("role" = 'super_admin' AND "company_id" IS NULL) OR
          ("role" != 'super_admin' AND "company_id" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_company_id" ON "users" ("company_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "billing" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "plan" varchar(100) NOT NULL,
        "max_users" integer NOT NULL,
        "effective_from" timestamptz NOT NULL DEFAULT now(),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_billing_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_billing_company_id" ON "billing" ("company_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "refresh_token_hash" varchar(255) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_sessions_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP INDEX "IDX_billing_company_id"`);
    await queryRunner.query(`DROP TABLE "billing"`);
    await queryRunner.query(`DROP INDEX "IDX_users_company_id"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "companies"`);
    await queryRunner.query(`DROP TYPE "user_status"`);
    await queryRunner.query(`DROP TYPE "user_role"`);
    await queryRunner.query(`DROP TYPE "company_status"`);
  }
}
