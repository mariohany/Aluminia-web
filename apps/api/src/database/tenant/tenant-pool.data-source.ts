import 'reflect-metadata';
import { config } from 'dotenv';
import type { DataSourceOptions } from 'typeorm';
import { parseEnv } from '../../config/env.schema';

config();
const env = parseEnv(process.env);

/**
 * Nest connection name for the tenant pool. Injected as
 * `@InjectDataSource(TENANT_DATA_SOURCE)` — a constant rather than a
 * bare string so a typo is a compile error, not a runtime "connection
 * not found".
 */
export const TENANT_DATA_SOURCE = 'tenant';

/**
 * The connection pool every tenant query runs on.
 *
 * ONE pool shared by all tenants, not one pool per company. The
 * tempting alternative — a dedicated pool per company, created on first
 * use — reads as "more isolated", but at this project's ceiling of 250
 * companies it means 250 pools holding open connections to the same
 * Postgres instance, for a product where most companies are idle most
 * of the time. Managed Postgres caps connections; that design walks
 * straight into the cap.
 *
 * Instead, each query temporarily points its own transaction at the
 * right schema — see `TenantConnectionService`.
 *
 * Separate from the control-plane pool (`control-plane/data-source.ts`)
 * on purpose: that one is where `users`, `companies`, and `billing`
 * live, and nothing in here should ever reach them.
 */
export const tenantPoolDataSourceOptions: DataSourceOptions = {
  name: TENANT_DATA_SOURCE,
  type: 'postgres',
  url: env.DATABASE_URL,

  // NO `schema` option, deliberately. Setting one makes TypeORM emit
  // schema-qualified table names ("tenant_acme"."projects"), which would
  // hardcode a single tenant into every query this pool ever runs. Left
  // unset, TypeORM emits bare table names and Postgres resolves them
  // through `search_path` — which is what makes per-request switching
  // possible at all.
  entities: [`${__dirname}/entities/*.entity{.ts,.js}`],

  // This pool NEVER migrates. The tenant migration track is owned by
  // `createTenantDataSource` (provisioning) and `migrate-all-tenants.ts`,
  // both of which target one schema at a time on purpose. An empty list
  // here means a stray `runMigrations()` call on this pool is a no-op
  // rather than a schema-wide accident.
  migrations: [],

  // Migrations only, always — see CLAUDE.md's engineering standards.
  synchronize: false,
};
