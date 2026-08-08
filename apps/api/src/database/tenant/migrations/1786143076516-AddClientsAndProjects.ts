import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first BUSINESS tables in the tenant track — a manufacturer's
 * clients and the projects belonging to them (Phase 11).
 *
 * As with `InitialTenantSchema`, nothing here is schema-qualified. Both
 * paths that apply this migration point Postgres at the right schema
 * first — `createTenantDataSource` via its `schema` option, and
 * `TenantProvisioningService` via `SET LOCAL search_path` on its own
 * QueryRunner — so unqualified names resolve inside the tenant. Writing
 * a schema name here would hardcode one manufacturer into every other
 * manufacturer's migration.
 *
 * Note there is no lifecycle status column on `projects`. Archiving was
 * considered and dropped: a project is either here or deleted outright,
 * behind a confirmation dialog. See docs/projects_planing.md's
 * decisions table.
 */
export class AddClientsAndProjects1786143076516 implements MigrationInterface {
  name = 'AddClientsAndProjects1786143076516';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Bilingual by design: English required, Arabic optional, with the
    // UI falling back to English when Arabic is blank. Requiring both
    // would block saving a record until someone who writes Arabic is
    // available; see docs/projects_planing.md's bilingual rule.
    await queryRunner.query(`
      CREATE TABLE "clients" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "en_name" varchar(255) NOT NULL,
        "ar_name" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "en_name" varchar(255) NOT NULL,
        "ar_name" varchar(255),
        "en_address" text,
        "ar_address" text,
        "notes" text,
        "phone" varchar(50),
        "email" varchar(255),
        "client_id" uuid NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_projects_client" FOREIGN KEY ("client_id")
          REFERENCES "clients"("id") ON DELETE CASCADE
      )
    `);

    // Postgres does NOT index a foreign key automatically, and this one
    // is read on every tree load.
    await queryRunner.query(
      `CREATE INDEX "IDX_projects_client_id" ON "projects" ("client_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order of `up`. `projects` first: dropping `clients` while
    // the FK exists would fail.
    await queryRunner.query(`DROP TABLE "projects"`);
    await queryRunner.query(`DROP TABLE "clients"`);
  }
}
