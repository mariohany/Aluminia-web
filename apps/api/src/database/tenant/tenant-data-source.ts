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

    // `schema` above is NOT enough on its own, and assuming it was cost
    // a real incident on 2026-08-08.
    //
    // TypeORM's `schema` option only qualifies table names that TypeORM
    // itself generates from entity metadata. A migration is raw SQL —
    // `CREATE TABLE "clients"` — and TypeORM does not rewrite it. With
    // no search_path set, Postgres resolved those unqualified names
    // against the default path and created the tables, and the
    // `project_status` enum, in `public`. The first tenant "migrated"
    // successfully while writing into the control plane; the second
    // failed only because the enum it was about to create already
    // existed. A silent cross-schema write that announces itself as a
    // name collision one tenant later is precisely the drift this
    // migration track exists to prevent.
    //
    // Setting search_path at the connection level fixes it for every
    // query this DataSource runs, raw or generated. `public` is
    // deliberately excluded, matching TenantConnectionService: with it
    // on the path, a query for a tenant table that doesn't exist yet
    // would silently fall through to a same-named control-plane table.
    //
    // Safe to interpolate: `assertValidSchemaName` above constrains this
    // to `^tenant_[a-z0-9_]{1,55}$`, which needs no quoting and cannot
    // carry an injection payload.
    extra: { options: `-c search_path=${schemaName}` },

    entities: [`${__dirname}/entities/*.entity{.ts,.js}`],
    // The explicit list, not a glob — see migrations/index.ts for why.
    migrations: tenantMigrations,
    migrationsTableName: TENANT_MIGRATIONS_TABLE,
    synchronize: false,
  });
}
