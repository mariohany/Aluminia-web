import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ETA e-invoicing readiness (docs/payment_cycle_planing.md §9, Mario
 * 2026-11-05): the company as a buyer, its receiver type and structured
 * address, optional for now and kept beside the free-text addresses that
 * print.
 */
export class AddCompanyProfileEta1793400000000 implements MigrationInterface {
  name = 'AddCompanyProfileEta1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_profile"
         ADD COLUMN "buyer_type" varchar(1),
         ADD COLUMN "eta_country" varchar(2),
         ADD COLUMN "eta_governorate" varchar(80),
         ADD COLUMN "eta_city" varchar(80),
         ADD COLUMN "eta_street" varchar(160),
         ADD COLUMN "eta_building" varchar(40),
         ADD CONSTRAINT "CK_company_profile_buyer_type" CHECK ("buyer_type" IN ('B', 'P', 'F'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_profile"
         DROP CONSTRAINT "CK_company_profile_buyer_type",
         DROP COLUMN "eta_building",
         DROP COLUMN "eta_street",
         DROP COLUMN "eta_city",
         DROP COLUMN "eta_governorate",
         DROP COLUMN "eta_country",
         DROP COLUMN "buyer_type"`,
    );
  }
}
