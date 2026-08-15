import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type {
  CreateProjectInput,
  ProjectDetail,
  UpdateProjectInput,
} from '@repo/types/projects';
import { LookupScope, formatScopedRef, type ScopedRef } from '@repo/types/company-lookups';
import { Client } from '../../database/tenant/entities/client.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { resolveScopedRef } from '../company-lookups/scoped-ref.util';

/**
 * Projects — manufacturing jobs — inside one manufacturer's schema.
 *
 * Same rules as ClientsService: every body runs through
 * `tenantContext.run()`, nothing here knows a schema name, and no
 * repository is injected.
 *
 * There is no `list()`. The workspace tree is served by
 * `GET /clients` with projects nested, so a flat project list has no
 * caller — and an endpoint with no caller is an endpoint nobody keeps
 * correct.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  detail(id: string): Promise<ProjectDetail> {
    return this.tenantContext.run(async (manager) =>
      toDetail(await this.findOrFail(manager, id)),
    );
  }

  create(
    input: CreateProjectInput,
    createdByUserId: string,
  ): Promise<ProjectDetail> {
    return this.tenantContext.run(async (manager) => {
      // Checked inside the SAME run() as the insert, so it shares one
      // transaction with it. A lookup in a separate run() would be a
      // separate transaction and could go stale between the two — and
      // would also see none of this one's uncommitted work.
      //
      // The FK would reject a bad id anyway; this exists to turn a
      // raw constraint violation into a 400 that names the problem.
      const clientExists = await manager.exists(Client, {
        where: { id: input.clientId },
      });
      if (!clientExists) {
        throw new BadRequestException('That client does not exist.');
      }

      const brandPair = resolveScopedRefPair(input.defaultSystemBrand);
      const catalogPair = resolveScopedRefPair(input.defaultSystemCatalog);

      const project = manager.create(Project, {
        clientId: input.clientId,
        enName: input.enName,
        arName: input.arName ?? null,
        enAddress: input.enAddress ?? null,
        arAddress: input.arAddress ?? null,
        notes: input.notes ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        createdByUserId,
        defaultSystemPlatformBrandId: brandPair.platformId,
        defaultSystemCompanyBrandId: brandPair.companyId,
        defaultSystemPlatformCatalogId: catalogPair.platformId,
        defaultSystemCompanyCatalogId: catalogPair.companyId,
        currency: input.currency ?? null,
        vatRate: input.vatRate ?? null,
        discountRate: input.discountRate ?? null,
      });

      return toDetail(await manager.save(project));
    });
  }

  /**
   * Note what this cannot do: move a project to another client.
   * `UpdateProjectInput` has no `clientId`, so there is no path here to
   * reassign one — not a check that could be forgotten, an absence.
   */
  update(id: string, input: UpdateProjectInput): Promise<ProjectDetail> {
    return this.tenantContext.run(async (manager) => {
      const project = await this.findOrFail(manager, id);

      // `undefined` means "absent from this request" and must leave the
      // column alone; `null` means "clear this field". Collapsing them
      // would let a phone-number edit wipe the site address.
      if (input.enName !== undefined) project.enName = input.enName;
      if (input.arName !== undefined) project.arName = input.arName;
      if (input.enAddress !== undefined) project.enAddress = input.enAddress;
      if (input.arAddress !== undefined) project.arAddress = input.arAddress;
      if (input.notes !== undefined) project.notes = input.notes;
      if (input.phone !== undefined) project.phone = input.phone;
      if (input.email !== undefined) project.email = input.email;

      // Consistency rule (docs/project_preferences_planing.md §2): a
      // catalogue belongs to exactly one brand, but neither column pair
      // carries a FK to enforce that. Setting a new brand without also
      // setting a catalogue in the same request nulls the catalogue out
      // — otherwise a direct PATCH could leave the two disagreeing.
      if (input.defaultSystemBrand !== undefined) {
        const brandPair = resolveScopedRefPair(input.defaultSystemBrand);
        project.defaultSystemPlatformBrandId = brandPair.platformId;
        project.defaultSystemCompanyBrandId = brandPair.companyId;
        if (input.defaultSystemCatalog === undefined) {
          project.defaultSystemPlatformCatalogId = null;
          project.defaultSystemCompanyCatalogId = null;
        }
      }
      if (input.defaultSystemCatalog !== undefined) {
        const catalogPair = resolveScopedRefPair(input.defaultSystemCatalog);
        project.defaultSystemPlatformCatalogId = catalogPair.platformId;
        project.defaultSystemCompanyCatalogId = catalogPair.companyId;
      }
      if (input.currency !== undefined) project.currency = input.currency;
      if (input.vatRate !== undefined) project.vatRate = input.vatRate;
      if (input.discountRate !== undefined) project.discountRate = input.discountRate;

      return toDetail(await manager.save(project));
    });
  }

  /**
   * Hard delete of a single row. No typed confirmation server-side,
   * unlike clients: this destroys one project rather than cascading
   * through an unknown number of them, and a typed confirmation on
   * every delete trains people to type without reading. The dialog in
   * the UI is the friction.
   */
  remove(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const project = await this.findOrFail(manager, id);
      await manager.remove(project);
    });
  }

  private async findOrFail(
    manager: EntityManager,
    id: string,
  ): Promise<Project> {
    const project = await manager.findOne(Project, { where: { id } });
    // 404 rather than 403 for another tenant's id: the search_path makes
    // their rows invisible here, so there is nothing to distinguish
    // "belongs to someone else" from "does not exist" — which is the
    // correct answer to give either way.
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }
}

// `undefined` (absent from the request) leaves both columns of the pair
// alone; `null` (explicitly cleared) or a real `ScopedRef` resolves to
// the platform/company pair — same nullable-pair shape
// `company-lookups` already uses for a cross-scope parent, reused here
// via the same `resolveScopedRef` helper. See project.entity.ts's doc
// comment for why this pair carries no CHECK/FK, unlike that reuse.
function resolveScopedRefPair(
  ref: ScopedRef | null | undefined,
): { platformId: string | null; companyId: string | null } {
  if (!ref) return { platformId: null, companyId: null };
  return resolveScopedRef(ref);
}

function toScopedRef(
  platformId: string | null,
  companyId: string | null,
): ScopedRef | null {
  if (platformId) return formatScopedRef(LookupScope.PLATFORM, platformId);
  if (companyId) return formatScopedRef(LookupScope.COMPANY, companyId);
  return null;
}

function toDetail(project: Project): ProjectDetail {
  return {
    id: project.id,
    clientId: project.clientId,
    enName: project.enName,
    arName: project.arName,
    enAddress: project.enAddress,
    arAddress: project.arAddress,
    notes: project.notes,
    phone: project.phone,
    email: project.email,
    createdByUserId: project.createdByUserId,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    defaultSystemBrand: toScopedRef(
      project.defaultSystemPlatformBrandId,
      project.defaultSystemCompanyBrandId,
    ),
    defaultSystemCatalog: toScopedRef(
      project.defaultSystemPlatformCatalogId,
      project.defaultSystemCompanyCatalogId,
    ),
    currency: project.currency as ProjectDetail['currency'],
    vatRate: project.vatRate,
    discountRate: project.discountRate,
  };
}
