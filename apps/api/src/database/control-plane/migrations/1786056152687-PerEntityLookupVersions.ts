import { MigrationInterface, QueryRunner } from 'typeorm';

// Replaces the single global lookup_meta row with one row per entity —
// a write to `color` should retire only the colours slice's cache, not
// every lookup slice in the app. See packages/types/src/lookups.ts's
// LookupEntity for the full list and LOOKUP_SLICE_ENTITIES for how a
// read slice's cache key is built from its member entities' versions.
const LOOKUP_TABLES = [
  'color',
  'color_brand',
  'color_price',
  'glass',
  'glass_combination',
  'system_brand',
  'system_catalog',
  'system_profile',
] as const;

// glass_combination_item isn't its own row: items aren't exposed as
// their own resource, so a write to them bumps glass_combination's row
// instead — the same entity a combination's own writes bump.
const TABLE_TO_ENTITY: Record<string, (typeof LOOKUP_TABLES)[number]> =
  Object.fromEntries(LOOKUP_TABLES.map((t) => [t, t]));
TABLE_TO_ENTITY.glass_combination_item = 'glass_combination';

export class PerEntityLookupVersions1786056152687 implements MigrationInterface {
  name = 'PerEntityLookupVersions1786056152687';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of Object.keys(TABLE_TO_ENTITY)) {
      await queryRunner.query(
        `DROP TRIGGER "${table}_bump_lookup_version" ON "${table}"`,
      );
    }
    await queryRunner.query(`DROP FUNCTION "bump_lookup_version"()`);
    await queryRunner.query(`DROP TABLE "lookup_meta"`);

    await queryRunner.query(`
      CREATE TYPE "lookup_entity" AS ENUM (
        'color', 'color_brand', 'color_price',
        'glass', 'glass_combination',
        'system_brand', 'system_catalog', 'system_profile'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "lookup_meta" (
        "id" lookup_entity PRIMARY KEY,
        "version" integer NOT NULL DEFAULT 1
      )
    `);
    for (const entity of LOOKUP_TABLES) {
      await queryRunner.query(`INSERT INTO "lookup_meta" ("id") VALUES ($1)`, [
        entity,
      ]);
    }

    // Parametrized by the trigger's own CREATE TRIGGER argument
    // (TG_ARGV[0]) rather than one function per table — every trigger
    // below shares this single function, just bumping a different row.
    await queryRunner.query(`
      CREATE FUNCTION "bump_lookup_version"() RETURNS trigger AS $$
      BEGIN
        UPDATE "lookup_meta" SET "version" = "version" + 1 WHERE "id" = TG_ARGV[0]::lookup_entity;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    for (const [table, entity] of Object.entries(TABLE_TO_ENTITY)) {
      await queryRunner.query(`
        CREATE TRIGGER "${table}_bump_lookup_version"
          AFTER INSERT OR UPDATE OR DELETE ON "${table}"
          FOR EACH STATEMENT EXECUTE FUNCTION "bump_lookup_version"('${entity}')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of Object.keys(TABLE_TO_ENTITY)) {
      await queryRunner.query(
        `DROP TRIGGER "${table}_bump_lookup_version" ON "${table}"`,
      );
    }
    await queryRunner.query(`DROP FUNCTION "bump_lookup_version"()`);
    await queryRunner.query(`DROP TABLE "lookup_meta"`);
    await queryRunner.query(`DROP TYPE "lookup_entity"`);

    await queryRunner.query(`
      CREATE TABLE "lookup_meta" (
        "id" boolean PRIMARY KEY DEFAULT true,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "CK_lookup_meta_single_row" CHECK ("id")
      )
    `);
    await queryRunner.query(
      `INSERT INTO "lookup_meta" ("id", "version") VALUES (true, 1)`,
    );

    await queryRunner.query(`
      CREATE FUNCTION "bump_lookup_version"() RETURNS trigger AS $$
      BEGIN
        UPDATE "lookup_meta" SET "version" = "version" + 1;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    for (const table of Object.keys(TABLE_TO_ENTITY)) {
      await queryRunner.query(`
        CREATE TRIGGER "${table}_bump_lookup_version"
          AFTER INSERT OR UPDATE OR DELETE ON "${table}"
          FOR EACH STATEMENT EXECUTE FUNCTION "bump_lookup_version"()
      `);
    }
  }
}
