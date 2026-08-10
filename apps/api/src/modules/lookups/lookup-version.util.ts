import type { QueryRunner } from 'typeorm';
import { LookupEntity } from '@repo/types/lookups';

// Every lookup table's version-bump trigger is FOR EACH STATEMENT (see
// the PerEntityLookupVersions migration), so it fires once per event
// type (INSERT/UPDATE/DELETE) a statement touches — not once per
// statement, and not once per row. A bulk action that issues more than
// one statement (or touches more than one table mapped to the same
// entity, like glass_combination + glass_combination_item) can bump
// the same lookup_meta row more than once for what should read as a
// single user action (confirmed empirically: a one-statement INSERT
// ... ON CONFLICT DO UPDATE mixing creates and updates still bumps
// twice — once for the INSERT event, once for the UPDATE event).
//
// Disabling the affected table(s)' triggers for the duration of the
// work and bumping the row manually exactly once afterwards is the
// only way to guarantee one version step per bulk action, regardless
// of row count, statement count, or which tables were touched. Must
// run inside the caller's own transaction (queryRunner) so a failure
// mid-work can't leave a trigger disabled or a version bumped without
// the data change it was supposed to represent.
export async function runWithSingleVersionBump(
  queryRunner: QueryRunner,
  tables: string[],
  entity: LookupEntity,
  work: () => Promise<boolean>,
): Promise<void> {
  for (const table of tables) {
    await queryRunner.query(
      `ALTER TABLE "${table}" DISABLE TRIGGER "${table}_bump_lookup_version"`,
    );
  }
  let changed = false;
  try {
    changed = await work();
  } finally {
    for (const table of tables) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE TRIGGER "${table}_bump_lookup_version"`,
      );
    }
  }
  if (changed) {
    await queryRunner.query(
      `UPDATE "lookup_meta" SET "version" = "version" + 1 WHERE "id" = $1`,
      [entity],
    );
  }
}

// Bulk delete's "pre-check, then delete only what's safe" behaviour
// (see the color/glass/system-lookups services' bulkDelete* methods):
// every FK in this schema is ON DELETE RESTRICT except
// glass_combination -> glass_combination_item, so a row referenced
// elsewhere would otherwise fail the whole batch with a raw driver
// error instead of reporting back which specific rows are blocked.
export async function findBlockedIds(
  queryRunner: QueryRunner,
  ids: string[],
  referencingColumns: { table: string; column: string }[],
): Promise<Set<string>> {
  if (referencingColumns.length === 0) return new Set();
  const unionParts = referencingColumns.map(
    (ref) =>
      `SELECT "${ref.column}" AS id FROM "${ref.table}" WHERE "${ref.column}" = ANY($1::uuid[])`,
  );
  const rows = (await queryRunner.query(
    `SELECT DISTINCT id FROM (${unionParts.join(' UNION ALL ')}) blocked WHERE id IS NOT NULL`,
    [ids],
  )) as { id: string }[];
  return new Set(rows.map((row) => row.id));
}
