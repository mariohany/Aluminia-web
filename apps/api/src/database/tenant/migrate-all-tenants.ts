import controlPlaneDataSource from '../control-plane/data-source';
import { assertValidSchemaName } from './schema-name';
import { createTenantDataSource } from './tenant-data-source';

interface TenantRow {
  id: string;
  name: string;
  schema_name: string;
}

interface Result {
  schemaName: string;
  companyName: string;
  applied: string[];
  error?: string;
}

/**
 * Applies pending tenant migrations to EVERY company schema.
 *
 * This is how every future tenant schema change ships — adding a table
 * for one manufacturer means adding it for all of them. Run after
 * deploying a new migration in `tenant/migrations/`.
 *
 * Deliberately continues past a failing schema rather than aborting: if
 * company 7 of 250 fails, you want to know that companies 8-250 were
 * fine, not leave the rest unmigrated and have to work out where it
 * stopped. Each schema's migrations are transactional individually, so a
 * failure leaves that one schema unchanged, not half-migrated.
 */
export async function migrateAllTenants(): Promise<Result[]> {
  await controlPlaneDataSource.initialize();

  const tenants: TenantRow[] = await controlPlaneDataSource.query(
    `SELECT id, name, schema_name FROM companies ORDER BY created_at`,
  );

  const results: Result[] = [];

  for (const tenant of tenants) {
    const result: Result = {
      schemaName: tenant.schema_name,
      companyName: tenant.name,
      applied: [],
    };

    try {
      assertValidSchemaName(tenant.schema_name);
      const tenantDataSource = createTenantDataSource(tenant.schema_name);
      await tenantDataSource.initialize();
      try {
        const applied = await tenantDataSource.runMigrations();
        result.applied = applied.map((m) => m.name);
      } finally {
        await tenantDataSource.destroy();
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    results.push(result);
  }

  await controlPlaneDataSource.destroy();
  return results;
}

async function main() {
  const results = await migrateAllTenants();

  for (const result of results) {
    if (result.error) {
      console.error(
        `✖ ${result.schemaName} (${result.companyName}): ${result.error}`,
      );
    } else if (result.applied.length === 0) {
      console.log(
        `• ${result.schemaName} (${result.companyName}): already up to date`,
      );
    } else {
      console.log(
        `✔ ${result.schemaName} (${result.companyName}): applied ${result.applied.join(', ')}`,
      );
    }
  }

  const failed = results.filter((r) => r.error);
  console.log(
    `\n${results.length - failed.length}/${results.length} schemas up to date.`,
  );

  // Non-zero exit so CI/deploy pipelines actually notice a partial failure.
  if (failed.length > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('migrate-all-tenants failed:', err);
    process.exit(1);
  });
}
