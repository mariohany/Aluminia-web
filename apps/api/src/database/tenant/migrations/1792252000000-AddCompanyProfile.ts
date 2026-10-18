import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Config › Company profile — docs/company_profile_planing.md §2 (P1, P2,
 * P5): the company's letterhead, one row like `cutting_settings`. No row
 * means the defaults (the printed English name is the account name), so
 * existing tenants need no backfill. Lengths mirror
 * `COMPANY_PROFILE_LIMITS`.
 *
 * `logo_file_id` points at the control-plane `files` table, so there is
 * no foreign key across the two; `FilesService.attach` is the check.
 *
 * Not aluminium profiles (`company_system_profiles`).
 */
export class AddCompanyProfile1792252000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "company_profile" (
        "id" smallint PRIMARY KEY DEFAULT 1,
        "en_name" varchar(255) NOT NULL,
        "ar_name" varchar(255),
        "en_address" varchar(500),
        "ar_address" varchar(500),
        "phone" varchar(40),
        "email" varchar(255),
        "website" varchar(255),
        "tax_id" varchar(60),
        "commercial_register" varchar(60),
        "logo_file_id" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "CK_company_profile_single_row" CHECK ("id" = 1),
        CONSTRAINT "CK_company_profile_en_name" CHECK (length(trim("en_name")) > 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "company_profile"`);
  }
}
