import { MigrationInterface, QueryRunner } from 'typeorm';

// ETA e-invoicing readiness (docs/payment_cycle_planing.md §9, Mario
// 2026-11-05): the seller's activity code and branch address, each plan's
// EGS item code, and an invoice's ETA identity, empty until the
// integration (its own plan) submits it.
export class AddEtaFields1793400000001 implements MigrationInterface {
  name = 'AddEtaFields1793400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_profile"
         ADD "activity_code" varchar(10),
         ADD "eta_country" varchar(2),
         ADD "eta_governorate" varchar(80),
         ADD "eta_city" varchar(80),
         ADD "eta_street" varchar(160),
         ADD "eta_building" varchar(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD "eta_item_code" varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_documents"
         ADD "eta_uuid" varchar(64),
         ADD "eta_long_id" varchar(200),
         ADD "eta_status" varchar(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_documents" DROP COLUMN "eta_status", DROP COLUMN "eta_long_id", DROP COLUMN "eta_uuid"`,
    );
    await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN "eta_item_code"`);
    await queryRunner.query(
      `ALTER TABLE "billing_profile"
         DROP COLUMN "eta_building", DROP COLUMN "eta_street", DROP COLUMN "eta_city",
         DROP COLUMN "eta_governorate", DROP COLUMN "eta_country", DROP COLUMN "activity_code"`,
    );
  }
}
