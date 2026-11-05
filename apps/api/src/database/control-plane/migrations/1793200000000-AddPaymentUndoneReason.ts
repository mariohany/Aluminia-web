import { MigrationInterface, QueryRunner } from 'typeorm';

// Payment cycle P22 (Mario 2026-11-03): a payment recorded today can be
// taken back; the history keeps a row saying so.
export class AddPaymentUndoneReason1793200000000 implements MigrationInterface {
  name = 'AddPaymentUndoneReason1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing" DROP CONSTRAINT "CK_billing_reason",
        ADD CONSTRAINT "CK_billing_reason" CHECK ("reason" IN
          ('created', 'edited', 'trial_started', 'trial_extended', 'paid', 'trial_ended', 'plan_ended',
           'dropped_to_free', 'payment_undone'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "billing" SET "reason" = 'edited' WHERE "reason" = 'payment_undone'`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing" DROP CONSTRAINT "CK_billing_reason",
        ADD CONSTRAINT "CK_billing_reason" CHECK ("reason" IN
          ('created', 'edited', 'trial_started', 'trial_extended', 'paid', 'trial_ended', 'plan_ended',
           'dropped_to_free'))`,
    );
  }
}
