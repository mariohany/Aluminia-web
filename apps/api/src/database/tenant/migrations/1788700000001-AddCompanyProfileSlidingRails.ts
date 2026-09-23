import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tenant-side counterpart of the control-plane's AddProfileSlidingRails
 * — a company's own frame profiles carry the same nullable rail count,
 * same CHECK, same backfill rule (2 for a frame in a sliding catalogue).
 *
 * The backfill has to look at TWO catalogue tables, because a company
 * profile hangs off either the platform's shared `system_catalog` (via
 * `platform_catalog_id`, no FK — see CompanyPaintingPrice) or the
 * company's own `company_system_catalog`. The platform table lives in
 * `public`, which the tenant search_path deliberately excludes
 * (TenantConnectionService), so it's schema-qualified here on purpose.
 */
export class AddCompanyProfileSlidingRails1788700000001 implements MigrationInterface {
  name = 'AddCompanyProfileSlidingRails1788700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_system_profile" ADD COLUMN "sliding_rails" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_system_profile"
         ADD CONSTRAINT "CK_company_system_profile_sliding_rails"
         CHECK ("sliding_rails" IS NULL OR "sliding_rails" BETWEEN 2 AND 4)`,
    );
    await queryRunner.query(
      `UPDATE "company_system_profile" AS p
         SET "sliding_rails" = 2
         FROM "public"."system_catalog" AS c
         WHERE c.id = p."platform_catalog_id"
           AND p."profile_type" = 'frame'
           AND c."system_type" = 'sliding'`,
    );
    await queryRunner.query(
      `UPDATE "company_system_profile" AS p
         SET "sliding_rails" = 2
         FROM "company_system_catalog" AS c
         WHERE c.id = p."company_catalog_id"
           AND p."profile_type" = 'frame'
           AND c."system_type" = 'sliding'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_system_profile" DROP CONSTRAINT "CK_company_system_profile_sliding_rails"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_system_profile" DROP COLUMN "sliding_rails"`,
    );
  }
}
