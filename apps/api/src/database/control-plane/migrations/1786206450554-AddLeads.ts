import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage E of docs/landing_planing.md: what the request-a-quote form on
 * the public landing page actually persists to.
 *
 * Control-plane, not tenant-scoped — a lead comes from an anonymous
 * visitor with no company and no login yet, the same category of data
 * as `users`/`companies`, not a manufacturer's own business data.
 *
 * No `status`/`contacted` column: this is a capture table, not a
 * worked pipeline. That's a real feature (a leads list/CRM view) this
 * phase deliberately doesn't build — see admin_dashboard_planing.md's
 * "Remaining work" section.
 */
export class AddLeads1786206450554 implements MigrationInterface {
  name = 'AddLeads1786206450554';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "leads" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_name" varchar(120) NOT NULL,
        "requester_name" varchar(120) NOT NULL,
        "phone" varchar(20) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    // The dashboard's "incoming leads" tile reads a recent/total count;
    // an index on created_at is what keeps that cheap once this table
    // has real volume.
    await queryRunner.query(
      `CREATE INDEX "IDX_leads_created_at" ON "leads" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_leads_created_at"`);
    await queryRunner.query(`DROP TABLE "leads"`);
  }
}
