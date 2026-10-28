import { MigrationInterface, QueryRunner } from 'typeorm';

// Step 2 of docs/subscriptions_planing.md (sections 3b, 3c): a company
// points at one of the four plans and carries its own end date, trial
// flag, currency and VAT; the billing history says why each row was
// written and who wrote it.
//
// No real companies exist yet (B25, Mario wipes them at launch), but
// dev and test data must keep working: a free-text plan that names a
// plan key keeps it, anything else becomes Pro, and every paid company
// gets a year from today so nothing is blocked once expiry is enforced.
export class AddCompanySubscriptions1792800100000 implements MigrationInterface {
  name = 'AddCompanySubscriptions1792800100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies"
        ADD "name_ar" character varying(255),
        ADD "plan_id" uuid,
        ADD "ends_at" TIMESTAMP WITH TIME ZONE,
        ADD "is_trial" boolean NOT NULL DEFAULT false,
        ADD "currency" character(3) NOT NULL DEFAULT 'EGP',
        ADD "vat_rate" numeric(5,2) NOT NULL DEFAULT 14,
        ADD "free_project_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "companies" c SET "plan_id" = COALESCE(
        (SELECT p."id" FROM "plans" p WHERE p."key" = lower(c."plan")),
        (SELECT p."id" FROM "plans" p WHERE p."key" = 'pro'))`,
    );
    await queryRunner.query(
      `UPDATE "companies" c SET "ends_at" = (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo')
          + interval '1 year' + interval '1 day' - interval '1 second') AT TIME ZONE 'Africa/Cairo'
        FROM "plans" p WHERE p."id" = c."plan_id" AND p."key" <> 'free'`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies"
        ALTER "plan_id" SET NOT NULL,
        DROP COLUMN "plan",
        ADD CONSTRAINT "FK_companies_plan" FOREIGN KEY ("plan_id")
          REFERENCES "plans"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "CK_companies_currency" CHECK ("currency" IN ('EGP', 'SAR', 'AED', 'USD', 'EUR')),
        ADD CONSTRAINT "CK_companies_vat_rate" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 100)`,
    );

    await queryRunner.query(
      `ALTER TABLE "billing"
        ADD "plan_id" uuid,
        ADD "ends_at" TIMESTAMP WITH TIME ZONE,
        ADD "is_trial" boolean NOT NULL DEFAULT false,
        ADD "reason" character varying(30) NOT NULL DEFAULT 'edited',
        ADD "document_id" uuid,
        ADD "actor_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "billing" b SET "plan_id" = COALESCE(
        (SELECT p."id" FROM "plans" p WHERE p."key" = lower(b."plan")),
        (SELECT c."plan_id" FROM "companies" c WHERE c."id" = b."company_id"))`,
    );
    // The first row of each company is the one provisioning wrote.
    await queryRunner.query(
      `UPDATE "billing" b SET "reason" = 'created' WHERE b."id" IN (
        SELECT DISTINCT ON ("company_id") "id" FROM "billing"
        ORDER BY "company_id", "effective_from", "created_at")`,
    );
    // actor_id is SET NULL: deleting a super admin must not lose history.
    // document_id gets its foreign key with billing_documents (step 6).
    await queryRunner.query(
      `ALTER TABLE "billing"
        ALTER "plan_id" SET NOT NULL,
        ALTER "reason" DROP DEFAULT,
        DROP COLUMN "plan",
        ADD CONSTRAINT "FK_billing_plan" FOREIGN KEY ("plan_id")
          REFERENCES "plans"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_billing_actor" FOREIGN KEY ("actor_id")
          REFERENCES "users"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "CK_billing_reason" CHECK ("reason" IN
          ('created', 'edited', 'trial_started', 'paid', 'trial_ended', 'dropped_to_free'))`,
    );

    // B13 / B14: who the drop to Free deactivated, so a paid plan brings
    // exactly them back.
    await queryRunner.query(
      `ALTER TABLE "users" ADD "plan_deactivated" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "plan_deactivated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing" ADD "plan" character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "billing" b SET "plan" = p."key" FROM "plans" p WHERE p."id" = b."plan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing"
        ALTER "plan" SET NOT NULL,
        DROP CONSTRAINT "CK_billing_reason",
        DROP CONSTRAINT "FK_billing_actor",
        DROP CONSTRAINT "FK_billing_plan",
        DROP COLUMN "plan_id",
        DROP COLUMN "ends_at",
        DROP COLUMN "is_trial",
        DROP COLUMN "reason",
        DROP COLUMN "document_id",
        DROP COLUMN "actor_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD "plan" character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "companies" c SET "plan" = p."key" FROM "plans" p WHERE p."id" = c."plan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies"
        ALTER "plan" SET NOT NULL,
        DROP CONSTRAINT "CK_companies_vat_rate",
        DROP CONSTRAINT "CK_companies_currency",
        DROP CONSTRAINT "FK_companies_plan",
        DROP COLUMN "plan_id",
        DROP COLUMN "name_ar",
        DROP COLUMN "ends_at",
        DROP COLUMN "is_trial",
        DROP COLUMN "currency",
        DROP COLUMN "vat_rate",
        DROP COLUMN "free_project_id"`,
    );
  }
}
