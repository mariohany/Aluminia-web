import { MigrationInterface, QueryRunner } from 'typeorm';

// The company's own lookups get versions like the platform's
// (control-plane 1786056152687-PerEntityLookupVersions), so the web can
// keep them in memory until one changes (docs/lookup_caching_planing.md
// §5.2). Same 8 entities as `LookupEntity` in @repo/types/lookups.
const ENTITIES = [
  'color',
  'paint_brand',
  'painting_price',
  'glass',
  'glass_combination',
  'system_brand',
  'system_catalog',
  'system_profile',
] as const;

// Items aren't their own resource: a write to them bumps the
// combination's row, as on the platform side.
const TABLE_TO_ENTITY: Record<string, (typeof ENTITIES)[number]> =
  Object.fromEntries(ENTITIES.map((e) => [`company_${e}`, e]));
TABLE_TO_ENTITY.company_glass_combination_item = 'glass_combination';

export class AddCompanyLookupVersions1792460000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // text + CHECK rather than the platform's `lookup_entity` enum: that
    // type lives in `public`, which a tenant search_path leaves out.
    await queryRunner.query(`
      CREATE TABLE "company_lookup_meta" (
        "id" text PRIMARY KEY,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "CK_company_lookup_meta_id"
          CHECK ("id" IN (${ENTITIES.map((e) => `'${e}'`).join(', ')}))
      )
    `);
    for (const entity of ENTITIES) {
      await queryRunner.query(
        `INSERT INTO "company_lookup_meta" ("id") VALUES ($1)`,
        [entity],
      );
    }

    // Updates the meta table in the trigger's own schema (TG_TABLE_SCHEMA),
    // not whatever search_path the writer happens to have, so a write
    // from a script or a migration still bumps the right company's row.
    await queryRunner.query(`
      CREATE FUNCTION "bump_company_lookup_version"() RETURNS trigger AS $$
      BEGIN
        EXECUTE format(
          'UPDATE %I."company_lookup_meta" SET "version" = "version" + 1 WHERE "id" = $1',
          TG_TABLE_SCHEMA
        ) USING TG_ARGV[0];
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    for (const [table, entity] of Object.entries(TABLE_TO_ENTITY)) {
      await queryRunner.query(`
        CREATE TRIGGER "${table}_bump_lookup_version"
          AFTER INSERT OR UPDATE OR DELETE ON "${table}"
          FOR EACH STATEMENT EXECUTE FUNCTION "bump_company_lookup_version"('${entity}')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of Object.keys(TABLE_TO_ENTITY)) {
      await queryRunner.query(
        `DROP TRIGGER "${table}_bump_lookup_version" ON "${table}"`,
      );
    }
    await queryRunner.query(`DROP FUNCTION "bump_company_lookup_version"()`);
    await queryRunner.query(`DROP TABLE "company_lookup_meta"`);
  }
}
