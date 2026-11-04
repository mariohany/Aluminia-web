import { MigrationInterface, QueryRunner } from 'typeorm';

// Payment cycle §6, P12, P22 (Mario 2026-11-03/05): a payment's note, when
// it was recorded (the same-day undo), a reference used once per method,
// and the subscription from before it on its history row (the undo puts
// it back).
export class AddPaymentRecordFields1793100000000 implements MigrationInterface {
  name = 'AddPaymentRecordFields1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_documents"
        ADD "payment_note" varchar(500),
        ADD "payment_recorded_at" timestamptz`,
    );
    await queryRunner.query(
      `UPDATE "billing_documents" SET "payment_recorded_at" = "created_at" WHERE "kind" = 'invoice'`,
    );
    // References typed twice before this rule keep the first; later ones
    // get their invoice number appended, so the index can be built.
    await queryRunner.query(
      `UPDATE "billing_documents" d SET "payment_reference" = left(d."payment_reference", 70) || ' · ' || d."number"
       WHERE d."kind" = 'invoice' AND EXISTS (
         SELECT 1 FROM "billing_documents" o
         WHERE o."kind" = 'invoice' AND o."payment_method" = d."payment_method"
           AND lower(o."payment_reference") = lower(d."payment_reference")
           AND (o."created_at", o."id") < (d."created_at", d."id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_billing_documents_payment_reference"
       ON "billing_documents" ("payment_method", lower("payment_reference")) WHERE "kind" = 'invoice'`,
    );
    await queryRunner.query(`ALTER TABLE "billing" ADD "previous" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "billing" DROP COLUMN "previous"`);
    await queryRunner.query(
      `DROP INDEX "UQ_billing_documents_payment_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_documents" DROP COLUMN "payment_recorded_at", DROP COLUMN "payment_note"`,
    );
  }
}
