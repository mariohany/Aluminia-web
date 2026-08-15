import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seven new nullable columns on `projects` — a project's optional
 * defaults for the window designer, set at creation or any time after
 * (docs/project_preferences_planing.md).
 *
 * The two cross-scope references (system brand, system catalogue) reuse
 * the nullable-pair storage shape `AddCompanyLookups` already
 * established for "this row's parent may be either a platform row or a
 * company row" (`platform_x_id` / `company_x_id`, converted to/from the
 * API's `ScopedRef` strings via `resolveScopedRef`/`formatScopedRef`).
 *
 * Unlike that migration's own uses of the pair shape, neither half here
 * carries a CHECK or a foreign key. `company_system_catalog`'s brand
 * pair is a required structural parent (exactly one side must be set,
 * enforced by `CK_company_system_catalog_one_brand`, with a real FK +
 * ON DELETE RESTRICT on the company side). A project's default is not
 * that — it's a soft preference that both a project and a window may
 * simply not have, and it is expected to be able to outlive its target
 * (a brand or catalogue can be deleted after a project defaulted to
 * it). So: both halves of each pair may be null at once, and neither
 * half is a foreign key — a dangling reference is resolved and
 * surfaced as "unavailable" on read (client-side, against the merged
 * catalogue), never prevented at write time. See
 * docs/project_preferences_planing.md's "Why brand/catalogue are a
 * nullable pair" section for the full reasoning.
 */
export class AddProjectPreferences1786786169898 implements MigrationInterface {
  name = 'AddProjectPreferences1786786169898';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "projects"
        ADD COLUMN "default_system_platform_brand_id" uuid,
        ADD COLUMN "default_system_company_brand_id" uuid,
        ADD COLUMN "default_system_platform_catalog_id" uuid,
        ADD COLUMN "default_system_company_catalog_id" uuid,
        ADD COLUMN "currency" varchar(3),
        ADD COLUMN "vat_rate" numeric(5,2),
        ADD COLUMN "discount_rate" numeric(5,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "projects"
        DROP COLUMN "default_system_platform_brand_id",
        DROP COLUMN "default_system_company_brand_id",
        DROP COLUMN "default_system_platform_catalog_id",
        DROP COLUMN "default_system_company_catalog_id",
        DROP COLUMN "currency",
        DROP COLUMN "vat_rate",
        DROP COLUMN "discount_rate"
    `);
  }
}
