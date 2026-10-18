import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type {
  ProjectSettings,
  UpdateProjectSettingsInput,
} from '@repo/types/project-settings';
import { ProjectSettingsRow } from '../../database/tenant/entities/project-settings.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  resolveScopedRefPair,
  toScopedRef,
} from '../company-lookups/scoped-ref.util';

/**
 * Config › Project settings: the new-project defaults
 * (docs/project_settings_planing.md S2, S3). One tenant row, seeded by the
 * migration with EGP. The web copies these into the new-project dialog;
 * nothing here touches an existing project.
 */
@Injectable()
export class ProjectSettingsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  get(): Promise<ProjectSettings> {
    return this.tenantContext.run(async (manager) =>
      toSettings(await findOrCreateRow(manager)),
    );
  }

  update(input: UpdateProjectSettingsInput): Promise<ProjectSettings> {
    return this.tenantContext.run(async (manager) => {
      const row = await findOrCreateRow(manager);
      // A missing key leaves the field alone; null clears it.
      if (input.defaultSystemBrand !== undefined) {
        const pair = resolveScopedRefPair(input.defaultSystemBrand);
        row.defaultSystemPlatformBrandId = pair.platformId;
        row.defaultSystemCompanyBrandId = pair.companyId;
      }
      if (input.defaultSystemCatalog !== undefined) {
        const pair = resolveScopedRefPair(input.defaultSystemCatalog);
        row.defaultSystemPlatformCatalogId = pair.platformId;
        row.defaultSystemCompanyCatalogId = pair.companyId;
      }
      if (input.currency !== undefined) row.currency = input.currency;
      row.updatedAt = new Date();
      return toSettings(await manager.save(row));
    });
  }
}

// The migration seeds the row; this only covers a schema where someone
// deleted it by hand, so a read never fails.
async function findOrCreateRow(
  manager: EntityManager,
): Promise<ProjectSettingsRow> {
  return (
    (await manager.findOne(ProjectSettingsRow, { where: { id: 1 } })) ??
    manager.create(ProjectSettingsRow, { id: 1, currency: 'EGP' })
  );
}

function toSettings(row: ProjectSettingsRow): ProjectSettings {
  return {
    defaultSystemBrand: toScopedRef(
      row.defaultSystemPlatformBrandId,
      row.defaultSystemCompanyBrandId,
    ),
    defaultSystemCatalog: toScopedRef(
      row.defaultSystemPlatformCatalogId,
      row.defaultSystemCompanyCatalogId,
    ),
    currency: row.currency as ProjectSettings['currency'],
    updatedAt: (row.updatedAt ?? new Date()).toISOString(),
  };
}
