import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { parseEnv } from '../../config/env.schema';
import { assertValidSchemaName } from './schema-name';
import { tenantMigrations } from './migrations';

config();
const env = parseEnv(process.env);

/**
 * Bookkeeping table for the tenant track, created inside each tenant
 * schema. Named differently from the control-plane's `migrations` table
 * so the two tracks can never be mistaken for one another.
 */
export const TENANT_MIGRATIONS_TABLE = 'tenant_migrations';

/**
 * Tenant migrations are a SEPARATE track from the control-plane ones:
 * different folder, different `migrationsTableName`, different runner.
 * Mixing the two is the classic way to corrupt a multi-tenant database —
 * a control-plane migration accidentally applied inside a tenant schema
 * (or vice versa) is very hard to unpick after the fact.
 *
 * Each tenant schema gets its own `tenant_migrations` bookkeeping table
 * *inside that schema*, so every tenant tracks its own migration state
 * independently.
 */
export function createTenantDataSource(schemaName: string): DataSource {
  // Belt and braces: this value is interpolated into DDL below, and
  // callers pass values read from the database. Validate every time.
  assertValidSchemaName(schemaName);

  return new DataSource({
    type: 'postgres',
    url: env.DATABASE_URL,
    schema: schemaName,
    entities: [`${__dirname}/entities/*.entity{.ts,.js}`],
    // The explicit list, not a glob — see migrations/index.ts for why.
    migrations: tenantMigrations,
    migrationsTableName: TENANT_MIGRATIONS_TABLE,
    synchronize: false,
  });
}
