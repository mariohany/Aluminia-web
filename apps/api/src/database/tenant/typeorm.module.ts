import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { tenantPoolDataSourceOptions } from './tenant-pool.data-source';

/**
 * Registers the tenant connection pool as a SECOND, named connection
 * alongside the control-plane one. Two pools against the same Postgres
 * instance, kept apart so a tenant query can never accidentally run on
 * the connection that reaches `users` / `companies` / `billing`.
 *
 * Mirrors `control-plane/typeorm.module.ts`. Nest's TypeORM module is
 * global, so importing this once in AppModule makes
 * `@InjectDataSource(TENANT_DATA_SOURCE)` work anywhere.
 */
@Module({
  imports: [TypeOrmModule.forRoot(tenantPoolDataSourceOptions)],
})
export class TenantDatabaseModule {}
