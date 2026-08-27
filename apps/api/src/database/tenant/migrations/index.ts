import type { MigrationInterface } from 'typeorm';
import { InitialTenantSchema1785971048351 } from './1785971048351-InitialTenantSchema';
import { AddClientsAndProjects1786143076516 } from './1786143076516-AddClientsAndProjects';
import { AddCompanyLookups1786531275742 } from './1786531275742-AddCompanyLookups';
import { AddProjectPreferences1786786169898 } from './1786786169898-AddProjectPreferences';
import { AddCompanyProfileFlyScreen1786831096555 } from './1786831096555-AddCompanyProfileFlyScreen';
import { AddWindows1786835416435 } from './1786835416435-AddWindows';
import { AddWindowOpeningType1786900000000 } from './1786900000000-AddWindowOpeningType';
import { AddWindowPanels1787632599315 } from './1787632599315-AddWindowPanels';

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
  AddCompanyLookups1786531275742,
  AddProjectPreferences1786786169898,
  AddCompanyProfileFlyScreen1786831096555,
  AddWindows1786835416435,
  AddWindowOpeningType1786900000000,
  AddWindowPanels1787632599315,
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
