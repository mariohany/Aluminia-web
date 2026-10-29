import { MigrationInterface, QueryRunner } from 'typeorm';

// Subscriptions step 8 (docs/subscriptions_planing.md §3e, B15, Q2): each
// warning email before the end goes out once per stage and end date. The
// alerts call claims a row (INSERT … ON CONFLICT DO NOTHING) before it
// sends, so two users opening the app at once send one email; a new end
// date (a renewal) starts the stages over.
export class AddBillingNotices1792800400000 implements MigrationInterface {
  name = 'AddBillingNotices1792800400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "billing_notices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "step" integer NOT NULL,
        "sent_to" text[] NOT NULL DEFAULT '{}',
        "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_notices_stage" UNIQUE ("company_id", "ends_at", "step"),
        CONSTRAINT "CK_billing_notices_step" CHECK ("step" IN (30, 15, 5, 1)),
        CONSTRAINT "FK_billing_notices_company" FOREIGN KEY ("company_id")
          REFERENCES "companies"("id") ON DELETE CASCADE
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_notices"`);
  }
}
