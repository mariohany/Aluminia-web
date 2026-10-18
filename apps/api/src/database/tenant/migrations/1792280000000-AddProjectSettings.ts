import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Config › Project settings — docs/project_settings_planing.md §3: three
 * tables and a column. Lengths and colour keys mirror
 * `@repo/types/project-settings`.
 *
 * - `project_settings`: one row of new-project defaults, seeded with EGP
 *   (what the new-project dialog hard-coded until now). The system refs
 *   are the same soft platform/company pairs as on `projects`: no CHECK,
 *   no FK.
 * - `project_statuses`: the company's list, seeded with the 7 built-in
 *   steps (S4). `responsible_user_ids` holds control-plane `users.id`s;
 *   an FK can't cross the two, so the API checks them on write and drops
 *   inactive / other-company ids on read. Positions are unique but
 *   DEFERRABLE, so a reorder can rewrite every row in one transaction.
 * - `projects.status_id`: every project sits in exactly one status;
 *   RESTRICT backs the API's "in use" refusal (S6). Existing projects
 *   start at status 1 (S14).
 * - `project_status_events`: the history. Name, colour and user email are
 *   snapshots, so a renamed or deleted status (SET NULL) or a removed user
 *   still reads right. The backfilled "created" events have no user: a
 *   tenant migration can't see `users`.
 */
export class AddProjectSettings1792280000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "project_settings" (
        "id" smallint PRIMARY KEY DEFAULT 1,
        "default_system_platform_brand_id" uuid,
        "default_system_company_brand_id" uuid,
        "default_system_platform_catalog_id" uuid,
        "default_system_company_catalog_id" uuid,
        "currency" varchar(3),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "CK_project_settings_single_row" CHECK ("id" = 1)
      )
    `);
    await queryRunner.query(
      `INSERT INTO "project_settings" ("id", "currency") VALUES (1, 'EGP')`,
    );

    await queryRunner.query(`
      CREATE TABLE "project_statuses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "position" integer NOT NULL,
        "en_name" varchar(60) NOT NULL,
        "ar_name" varchar(60),
        "color" varchar(16) NOT NULL,
        "responsible_user_ids" uuid[] NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "UQ_project_statuses_position" UNIQUE ("position")
          DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "CK_project_statuses_position" CHECK ("position" >= 1),
        CONSTRAINT "CK_project_statuses_en_name" CHECK (length(trim("en_name")) > 0),
        CONSTRAINT "CK_project_statuses_color" CHECK ("color" IN
          ('grey', 'blue', 'amber', 'green', 'violet', 'sky', 'emerald', 'red'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_project_statuses_en_name" ON "project_statuses" (lower("en_name"))`,
    );
    await queryRunner.query(`
      INSERT INTO "project_statuses" ("position", "en_name", "ar_name", "color") VALUES
        (1, 'New', 'جديد', 'grey'),
        (2, 'Measuring', 'قياس', 'blue'),
        (3, 'Quoted', 'تم التسعير', 'amber'),
        (4, 'Approved', 'معتمد', 'green'),
        (5, 'In production', 'قيد التصنيع', 'violet'),
        (6, 'Installed', 'تم التركيب', 'sky'),
        (7, 'Closed', 'مغلق', 'emerald')
    `);

    await queryRunner.query(
      `ALTER TABLE "projects" ADD "status_id" uuid
         CONSTRAINT "FK_projects_status" REFERENCES "project_statuses" ("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `UPDATE "projects" SET "status_id" = (SELECT "id" FROM "project_statuses" WHERE "position" = 1)`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" ALTER COLUMN "status_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_projects_status_id" ON "projects" ("status_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "project_status_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL
          CONSTRAINT "FK_project_status_events_project" REFERENCES "projects" ("id") ON DELETE CASCADE,
        "from_status_id" uuid
          CONSTRAINT "FK_project_status_events_from" REFERENCES "project_statuses" ("id") ON DELETE SET NULL,
        "to_status_id" uuid
          CONSTRAINT "FK_project_status_events_to" REFERENCES "project_statuses" ("id") ON DELETE SET NULL,
        "to_en_name" varchar(60) NOT NULL,
        "to_ar_name" varchar(60),
        "to_color" varchar(16) NOT NULL,
        "by_user_id" uuid,
        "by_user_email" varchar(255),
        "at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_project_status_events_project_at" ON "project_status_events" ("project_id", "at")`,
    );
    await queryRunner.query(`
      INSERT INTO "project_status_events"
        ("project_id", "to_status_id", "to_en_name", "to_ar_name", "to_color", "at")
      SELECT p."id", s."id", s."en_name", s."ar_name", s."color", p."created_at"
      FROM "projects" p
      JOIN "project_statuses" s ON s."position" = 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "project_status_events"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "status_id"`);
    await queryRunner.query(`DROP TABLE "project_statuses"`);
    await queryRunner.query(`DROP TABLE "project_settings"`);
  }
}
