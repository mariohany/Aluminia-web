import { ForbiddenException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { FilePurpose } from '@repo/types/files';
import {
  missingProfileFields,
  type CompanyProfile,
  type UpdateCompanyProfileInput,
} from '@repo/types/company-profile';
import { CompanyProfileRow } from '../../database/tenant/entities/company-profile.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { FilesService } from '../files/files.service';

/**
 * Config › Company profile (docs/company_profile_planing.md §4). One
 * tenant row; no row = defaults, with the account name
 * (`companies.name`) as the printed English name (P1).
 *
 * The logo is a `files` id. A new one is attached (checked: this
 * company's, purpose `logo`, not used elsewhere) inside the same tenant
 * run that writes it; if that run fails, it is detached again. The
 * replaced logo is released only after the commit, so a failed save
 * never loses the old one.
 */
@Injectable()
export class CompanyProfileService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly files: FilesService,
  ) {}

  get(): Promise<CompanyProfile> {
    return this.tenantContext.run(async (manager) =>
      toProfile(await findRow(manager), this.tenantContext.tenant.companyName),
    );
  }

  async update(input: UpdateCompanyProfileInput): Promise<CompanyProfile> {
    const { companyId, companyName } = this.tenantContext.tenant;
    let attached: string | null = null;
    let replaced: string | null = null;

    let profile: CompanyProfile;
    try {
      profile = await this.tenantContext.run(async (manager) => {
        const row =
          (await findRow(manager)) ??
          manager.create(CompanyProfileRow, { id: 1, enName: companyName });

        if (
          input.logoFileId !== undefined &&
          input.logoFileId !== row.logoFileId
        ) {
          if (input.logoFileId) {
            await this.files.attach(
              companyId,
              input.logoFileId,
              FilePurpose.LOGO,
            );
            attached = input.logoFileId;
          }
          replaced = row.logoFileId;
          row.logoFileId = input.logoFileId;
        }

        // The logo was handled above, through FilesService.
        const text = definedOnly(input);
        delete text.logoFileId;
        Object.assign(row, text);
        row.updatedAt = new Date();
        return toProfile(await manager.save(row), companyName);
      });
    } catch (error) {
      if (attached) await this.files.detach(companyId, attached);
      throw error;
    }

    if (replaced) await this.files.release(companyId, replaced);
    return profile;
  }
}

/**
 * Nothing prints until the profile is complete (B23, Mario 2026-10-28:
 * only PDFs are blocked, every page stays usable): 403
 * `profile_incomplete`, with the missing fields.
 */
export async function assertProfileComplete(
  manager: EntityManager,
  accountName: string,
): Promise<void> {
  const missing = missingProfileFields(
    toProfile(await findRow(manager), accountName),
  );
  if (missing.length) {
    throw new ForbiddenException({
      message: 'Complete the company profile first.',
      code: 'profile_incomplete',
    });
  }
}

function findRow(manager: EntityManager): Promise<CompanyProfileRow | null> {
  return manager.findOne(CompanyProfileRow, { where: { id: 1 } });
}

/** PATCH semantics: a key left out is left alone; null clears. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

function toProfile(
  row: CompanyProfileRow | null,
  accountName: string,
): CompanyProfile {
  return {
    enName: row?.enName ?? accountName,
    arName: row?.arName ?? null,
    enAddress: row?.enAddress ?? null,
    arAddress: row?.arAddress ?? null,
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    website: row?.website ?? null,
    taxId: row?.taxId ?? null,
    commercialRegister: row?.commercialRegister ?? null,
    logoFileId: row?.logoFileId ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}
