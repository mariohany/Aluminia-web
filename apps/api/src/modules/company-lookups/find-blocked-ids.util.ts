import type { EntityManager } from 'typeorm';

// Tenant-schema counterpart to lookups/lookup-version.util.ts's
// findBlockedIds — same idea (pre-check which of a bulk-delete's ids are
// still referenced elsewhere, so those can be reported back instead of
// failing the whole batch), just against the request's tenant
// `EntityManager` (from `tenantContext.run()`) instead of a queryRunner
// pulled straight off a DataSource. Every company_* FK in the migration
// is ON DELETE RESTRICT except glass_combination -> glass_combination_item,
// matching the platform schema's own shape.
export async function findBlockedIds(
  manager: EntityManager,
  ids: string[],
  referencingColumns: { table: string; column: string }[],
): Promise<Set<string>> {
  if (referencingColumns.length === 0) return new Set();
  const unionParts = referencingColumns.map(
    (ref) =>
      `SELECT "${ref.column}" AS id FROM "${ref.table}" WHERE "${ref.column}" = ANY($1::uuid[])`,
  );
  const rows = await manager.query<{ id: string }[]>(
    `SELECT DISTINCT id FROM (${unionParts.join(' UNION ALL ')}) blocked WHERE id IS NOT NULL`,
    [ids],
  );
  return new Set(rows.map((row) => row.id));
}
