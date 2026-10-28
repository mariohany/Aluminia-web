import { MigrationInterface, QueryRunner } from 'typeorm';

// Subscriptions step 6 (docs/subscriptions_planing.md §3d, §3e, §4d).
//
// billing_documents holds quotations and invoices in one table. A document
// keeps what it was issued with (plan names, prices, rate, seller, buyer):
// nothing here reads live data back. An invoice is always paid and always
// carries its payment; a quotation has at most one invoice. Like `billing`,
// the rows go with a permanently deleted company.
//
// created_at keeps milliseconds only, like a JS Date, so the Transactions
// cursor (created_at, id) never skips a row.
//
// billing_sends records each email of a document (step 8 sends them).
export class AddBillingDocuments1792800300000 implements MigrationInterface {
  name = 'AddBillingDocuments1792800300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "billing_documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "number" character varying(30) NOT NULL,
        "status" character varying(20) NOT NULL,
        "quotation_id" uuid,
        "plan_id" uuid NOT NULL,
        "plan_name_en" character varying(60) NOT NULL,
        "plan_name_ar" character varying(60) NOT NULL,
        "seats" integer NOT NULL,
        "months" integer NOT NULL,
        "starts_on" date NOT NULL,
        "ends_on" date NOT NULL,
        "currency" character varying(3) NOT NULL,
        "fx_rate" numeric(18,8),
        "fx_date" date,
        "unit_price" numeric(14,2) NOT NULL,
        "subtotal" numeric(14,2) NOT NULL,
        "discount_kind" character varying(10),
        "discount_value" numeric(14,2),
        "discount_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "vat_rate" numeric(5,2) NOT NULL,
        "vat_amount" numeric(14,2) NOT NULL,
        "total" numeric(14,2) NOT NULL,
        "total_egp" numeric(16,2) NOT NULL,
        "valid_until" date,
        "note" text,
        "seller" jsonb NOT NULL,
        "buyer" jsonb NOT NULL,
        "paid_on" date,
        "amount_received" numeric(14,2),
        "payment_method" character varying(20),
        "payment_reference" character varying(100),
        "created_by" uuid,
        "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_documents_number" UNIQUE ("number"),
        CONSTRAINT "UQ_billing_documents_quotation" UNIQUE ("quotation_id"),
        CONSTRAINT "CK_billing_documents_kind" CHECK ("kind" IN ('quotation', 'invoice')),
        CONSTRAINT "CK_billing_documents_status" CHECK ("status" IN ('draft', 'sent', 'paid', 'void')),
        CONSTRAINT "CK_billing_documents_months" CHECK ("months" IN (1, 3, 6, 12)),
        CONSTRAINT "CK_billing_documents_seats" CHECK ("seats" >= 1),
        CONSTRAINT "CK_billing_documents_period" CHECK ("ends_on" >= "starts_on"),
        CONSTRAINT "CK_billing_documents_currency" CHECK ("currency" IN ('EGP', 'SAR', 'AED', 'USD', 'EUR')),
        CONSTRAINT "CK_billing_documents_fx" CHECK (("currency" = 'EGP') = ("fx_rate" IS NULL)),
        CONSTRAINT "CK_billing_documents_discount" CHECK (
          ("discount_kind" IS NULL AND "discount_value" IS NULL)
          OR ("discount_kind" IN ('percent', 'amount') AND "discount_value" >= 0)),
        CONSTRAINT "CK_billing_documents_method" CHECK (
          "payment_method" IS NULL OR "payment_method" IN ('bank_transfer', 'instapay', 'cash', 'cheque')),
        CONSTRAINT "CK_billing_documents_invoice" CHECK (
          "kind" = 'quotation'
          OR ("status" = 'paid' AND "quotation_id" IS NOT NULL AND "paid_on" IS NOT NULL
              AND "amount_received" IS NOT NULL AND "payment_method" IS NOT NULL
              AND "payment_reference" IS NOT NULL)),
        CONSTRAINT "FK_billing_documents_company" FOREIGN KEY ("company_id")
          REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_documents_quotation" FOREIGN KEY ("quotation_id")
          REFERENCES "billing_documents"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_documents_plan" FOREIGN KEY ("plan_id")
          REFERENCES "plans"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_billing_documents_created_by" FOREIGN KEY ("created_by")
          REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    // Transactions: newest first, paged by (created_at, id).
    await queryRunner.query(
      `CREATE INDEX "IDX_billing_documents_newest" ON "billing_documents" ("created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_billing_documents_company" ON "billing_documents" ("company_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing" ADD CONSTRAINT "FK_billing_document" FOREIGN KEY ("document_id")
        REFERENCES "billing_documents"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "billing_sends" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "document_id" uuid NOT NULL,
        "to" text[] NOT NULL,
        "subject" character varying(255) NOT NULL,
        "copy_to_me" boolean NOT NULL DEFAULT false,
        "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "provider_message_id" character varying(255),
        "error" text,
        "sent_by" uuid,
        CONSTRAINT "FK_billing_sends_document" FOREIGN KEY ("document_id")
          REFERENCES "billing_documents"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_sends_sent_by" FOREIGN KEY ("sent_by")
          REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_billing_sends_document" ON "billing_sends" ("document_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_sends"`);
    await queryRunner.query(
      `ALTER TABLE "billing" DROP CONSTRAINT "FK_billing_document"`,
    );
    await queryRunner.query(`UPDATE "billing" SET "document_id" = NULL`);
    await queryRunner.query(`DROP TABLE "billing_documents"`);
  }
}
