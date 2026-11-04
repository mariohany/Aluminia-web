import { MigrationInterface, QueryRunner } from 'typeorm';

// Payment cycle P10 (Mario 2026-11-03): a paid plan that runs out unpaid
// drops to Free like a trial, recorded with its own history reason.
export class AddPlanEndedReason1792900000000 implements MigrationInterface {
  name = 'AddPlanEndedReason1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing" DROP CONSTRAINT "CK_billing_reason",
        ADD CONSTRAINT "CK_billing_reason" CHECK ("reason" IN
          ('created', 'edited', 'trial_started', 'paid', 'trial_ended', 'plan_ended', 'dropped_to_free'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "billing" SET "reason" = 'dropped_to_free' WHERE "reason" = 'plan_ended'`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing" DROP CONSTRAINT "CK_billing_reason",
        ADD CONSTRAINT "CK_billing_reason" CHECK ("reason" IN
          ('created', 'edited', 'trial_started', 'paid', 'trial_ended', 'dropped_to_free'))`,
    );
  }
}
