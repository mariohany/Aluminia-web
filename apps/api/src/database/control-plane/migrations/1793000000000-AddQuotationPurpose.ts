import { MigrationInterface, QueryRunner } from 'typeorm';

// Payment cycle P11, P15, P30 (Mario 2026-11-04/05): a quotation is new,
// renewal or upgrade; seats = the plan's own + extra seats at a hand-typed
// price; an upgrade carries a credit for the unused days of what was paid.
export class AddQuotationPurpose1793000000000 implements MigrationInterface {
  name = 'AddQuotationPurpose1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_documents"
        ADD "purpose" varchar(10) NOT NULL DEFAULT 'new',
        ADD "extra_seats" int NOT NULL DEFAULT 0,
        ADD "extra_seat_price" numeric(14,2) NOT NULL DEFAULT 0,
        ADD "extra_seats_amount" numeric(14,2) NOT NULL DEFAULT 0,
        ADD "credit_amount" numeric(14,2) NOT NULL DEFAULT 0,
        ADD "credit_lines" jsonb NOT NULL DEFAULT '[]',
        ADD CONSTRAINT "CK_billing_documents_purpose" CHECK ("purpose" IN ('new', 'renewal', 'upgrade')),
        ADD CONSTRAINT "CK_billing_documents_extra_seats" CHECK ("extra_seats" >= 0 AND "extra_seats" < "seats")`,
    );
    // Seats above the plan's own become extra seats (priced at 0: their
    // price was inside the unit price).
    await queryRunner.query(
      `UPDATE "billing_documents" d SET "extra_seats" = GREATEST(d."seats" - p."seats", 0)
       FROM "plans" p WHERE p."id" = d."plan_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_documents"
        DROP CONSTRAINT "CK_billing_documents_extra_seats",
        DROP CONSTRAINT "CK_billing_documents_purpose",
        DROP COLUMN "credit_lines",
        DROP COLUMN "credit_amount",
        DROP COLUMN "extra_seats_amount",
        DROP COLUMN "extra_seat_price",
        DROP COLUMN "extra_seats",
        DROP COLUMN "purpose"`,
    );
  }
}
