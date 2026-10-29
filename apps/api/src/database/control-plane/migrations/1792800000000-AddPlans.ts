import { MigrationInterface, QueryRunner } from 'typeorm';

// Step 1 of docs/subscriptions_planing.md (section 3a): the four fixed
// plans. Free is fixed in code (one seat, client and project, no
// price); the CHECK keeps its row that way. The paid prices are
// examples that Mario replaces on the Plans page. Companies point at a
// plan from step 2 on.
export class AddPlans1792800000000 implements MigrationInterface {
  name = 'AddPlans1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "plans" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "key" character varying(20) NOT NULL,
        "name_en" character varying(60) NOT NULL,
        "name_ar" character varying(60) NOT NULL,
        "seats" integer NOT NULL,
        "monthly_egp" numeric(12,2),
        "annual_egp" numeric(12,2),
        "features" text[] NOT NULL DEFAULT '{}',
        "position" integer NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plans" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_plans_key" UNIQUE ("key"),
        CONSTRAINT "UQ_plans_position" UNIQUE ("position"),
        CONSTRAINT "CK_plans_key" CHECK ("key" IN ('free', 'individual', 'pro', 'ultimate')),
        CONSTRAINT "CK_plans_seats" CHECK ("seats" >= 1),
        CONSTRAINT "CK_plans_prices" CHECK (
          CASE WHEN "key" = 'free'
            THEN "monthly_egp" IS NULL AND "annual_egp" IS NULL AND "seats" = 1 AND "features" = '{}'
            ELSE "monthly_egp" > 0 AND "annual_egp" > 0
          END
        )
      )`,
    );
    await queryRunner.query(
      `INSERT INTO "plans" ("key", "name_en", "name_ar", "seats", "monthly_egp", "annual_egp", "features", "position") VALUES
        ('free', 'Free', 'مجاني', 1, NULL, NULL, '{}', 0),
        ('individual', 'Individual', 'فردي', 1, 1600, 17280, '{reports,data,project_settings}', 1),
        ('pro', 'Pro', 'احترافي', 5, 6000, 64800, '{reports,data,project_settings}', 2),
        ('ultimate', 'Ultimate', 'متكامل', 15, 13200, 142560, '{reports,data,project_settings}', 3)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "plans"`);
  }
}
