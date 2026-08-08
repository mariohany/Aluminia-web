import type { MigrationInterface } from 'typeorm';
import { InitialTenantSchema1785971048351 } from './1785971048351-InitialTenantSchema';
import { AddClientsAndProjects1786143076516 } from './1786143076516-AddClientsAndProjects';

/**
 * The tenant migration track, explicitly ordered.
 *
 * A hand-maintained list rather than a glob: both the provisioning path
 * and the migrate-all-tenants runner read from here, so there is exactly
 * one definition of "what migrations exist and in what order". A glob
 * would let the two paths silently disagree (different cwd, different
 * `.ts` vs `.js` resolution in dist), which in a multi-tenant system
 * means schemas drifting apart from each other.
 *
 * Append new migrations to the END of this array.
 */
export const tenantMigrations: Array<new () => MigrationInterface> = [
  InitialTenantSchema1785971048351,
  AddClientsAndProjects1786143076516,
];

/** TypeORM records applied migrations as `{timestamp}-{ClassName}`. */
export function migrationTimestamp(
  migration: new () => MigrationInterface,
): number {
  const match = /(\d+)$/.exec(migration.name);
  if (!match) {
    throw new Error(
      `Migration class ${migration.name} must end with its numeric timestamp.`,
    );
  }
  return Number(match[1]);
}
