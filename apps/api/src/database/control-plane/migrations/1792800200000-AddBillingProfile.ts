import { MigrationInterface, QueryRunner } from 'typeorm';

// Subscriptions step 5 (docs/subscriptions_planing.md §3e, B17).
//
// - files: the platform's own logo (purpose billing_logo) belongs to no
//   company, so company_id may be null, for that purpose and only that one.
// - billing_profile: one row, the seller printed on every quotation and
//   invoice. Created by the first save; until then nothing can be issued.
// - billing_counters: the last number issued per kind and year, taken with
//   FOR UPDATE in the transaction that issues the next one (no gaps).
// - fx_rates: one EGP rate per day and currency, fetched on first use.
export class AddBillingProfile1792800200000 implements MigrationInterface {
  name = 'AddBillingProfile1792800200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" ALTER COLUMN "company_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "CK_files_owner"
        CHECK (("purpose" = 'billing_logo') = ("company_id" IS NULL))`,
    );

    await queryRunner.query(
      `CREATE TABLE "billing_profile" (
        "id" integer NOT NULL DEFAULT 1,
        "legal_name_en" character varying(255) NOT NULL,
        "legal_name_ar" character varying(255) NOT NULL,
        "address_en" character varying(500) NOT NULL,
        "address_ar" character varying(500) NOT NULL,
        "tax_id" character varying(60) NOT NULL,
        "commercial_register" character varying(60) NOT NULL,
        "billing_email" character varying(255) NOT NULL,
        "phone" character varying(40),
        "bank_account" character varying(255) NOT NULL,
        "instapay" character varying(100),
        "logo_file_id" uuid,
        "updated_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_profile" PRIMARY KEY ("id"),
        CONSTRAINT "CK_billing_profile_one_row" CHECK ("id" = 1),
        CONSTRAINT "FK_billing_profile_logo" FOREIGN KEY ("logo_file_id")
          REFERENCES "files"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_billing_profile_updated_by" FOREIGN KEY ("updated_by")
          REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "billing_counters" (
        "kind" character varying(20) NOT NULL,
        "year" integer NOT NULL,
        "last" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_billing_counters" PRIMARY KEY ("kind", "year"),
        CONSTRAINT "CK_billing_counters_kind" CHECK ("kind" IN ('quotation', 'invoice')),
        CONSTRAINT "CK_billing_counters_last" CHECK ("last" >= 0)
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "fx_rates" (
        "date" date NOT NULL,
        "currency" character varying(3) NOT NULL,
        "egp_per_unit" numeric(18,8) NOT NULL,
        "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fx_rates" PRIMARY KEY ("date", "currency"),
        CONSTRAINT "CK_fx_rates_currency" CHECK ("currency" IN ('SAR', 'AED', 'USD', 'EUR')),
        CONSTRAINT "CK_fx_rates_positive" CHECK ("egp_per_unit" > 0)
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "fx_rates"`);
    await queryRunner.query(`DROP TABLE "billing_counters"`);
    await queryRunner.query(`DROP TABLE "billing_profile"`);
    await queryRunner.query(
      `DELETE FROM "files" WHERE "purpose" = 'billing_logo'`,
    );
    await queryRunner.query(
      `ALTER TABLE "files" DROP CONSTRAINT "CK_files_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "files" ALTER COLUMN "company_id" SET NOT NULL`,
    );
  }
}
