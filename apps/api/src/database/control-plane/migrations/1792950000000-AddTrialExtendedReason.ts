import { MigrationInterface, QueryRunner } from 'typeorm';

// Payment cycle P26 (Mario 2026-11-04): the super admin can add days to a
// trial, recorded with its own history reason.
export class AddTrialExtendedReason1792950000000 implements MigrationInterface {
  name = 'AddTrialExtendedReason1792950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing" DROP CONSTRAINT "CK_billing_reason",
        ADD CONSTRAINT "CK_billing_reason" CHECK ("reason" IN
          ('created', 'edited', 'trial_started', 'trial_extended', 'paid', 'trial_ended', 'plan_ended', 'dropped_to_free'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "billing" SET "reason" = 'edited' WHERE "reason" = 'trial_extended'`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing" DROP CONSTRAINT "CK_billing_reason",
        ADD CONSTRAINT "CK_billing_reason" CHECK ("reason" IN
          ('created', 'edited', 'trial_started', 'paid', 'trial_ended', 'plan_ended', 'dropped_to_free'))`,
    );
  }
}
