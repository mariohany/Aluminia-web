import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import type {
  CreateProjectInput,
  ProjectDetail,
  UpdateProjectInput,
} from '@repo/types/projects';
import type {
  ProjectStatusColor,
  ProjectStatusEvent,
} from '@repo/types/project-settings';
import { Client } from '../../database/tenant/entities/client.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { ProjectStatusEventRow } from '../../database/tenant/entities/project-status-event.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  firstProjectStatus,
  recordProjectCreated,
} from '../project-settings/project-status.util';
import {
  resolveScopedRefPair,
  toScopedRef,
} from '../company-lookups/scoped-ref.util';
import { PlanAccess } from '../subscriptions/plan-access.service';
import { Company } from '../../database/control-plane/entities/company.entity';

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
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly planAccess: PlanAccess,
  ) {}

  detail(id: string): Promise<ProjectDetail> {
    return this.tenantContext.run(async (manager) =>
      withStatus(manager, await this.findOrFail(manager, id)),
    );
  }

  /** The project's status history, newest first (project settings S10). */
  statusHistory(id: string): Promise<ProjectStatusEvent[]> {
    return this.tenantContext.run(async (manager) => {
      await this.findOrFail(manager, id);
      const events = await manager.find(ProjectStatusEventRow, {
        where: { projectId: id },
        order: { at: 'DESC', id: 'DESC' },
      });
      return events.map(toEvent);
    });
  }

  async create(
    input: CreateProjectInput,
    createdByUserId: string,
  ): Promise<ProjectDetail> {
    // Snapshot for the "created" history event; users live in the
    // control plane, so this is read before the tenant run.
    const creator = await this.users.findOne({
      where: { id: createdByUserId },
      select: { id: true, email: true },
    });
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
      await this.planAccess.assertCanCreate(manager, 'projects');

      const brandPair = resolveScopedRefPair(input.defaultSystemBrand);
      const catalogPair = resolveScopedRefPair(input.defaultSystemCatalog);
      const favoritePair = resolveScopedRefPair(input.favoriteFrameProfile);
      // A new project starts at the first status (project settings S13).
      const status = await firstProjectStatus(manager);

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
        favoritePlatformProfileId: favoritePair.platformId,
        favoriteCompanyProfileId: favoritePair.companyId,
        statusId: status.id,
      });

      const saved = await manager.save(project);
      await recordProjectCreated(manager, saved.id, status, {
        id: createdByUserId,
        email: creator?.email ?? null,
      });
      return withStatus(manager, saved);
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
      await this.planAccess.assertProjectsEditable(manager, [id]);

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
      if (input.discountRate !== undefined)
        project.discountRate = input.discountRate;

      // No cascade rule to mirror here (unlike brand/catalogue above) —
      // a favourite is a single reference, not a two-part pair that can
      // disagree with itself.
      if (input.favoriteFrameProfile !== undefined) {
        const favoritePair = resolveScopedRefPair(input.favoriteFrameProfile);
        project.favoritePlatformProfileId = favoritePair.platformId;
        project.favoriteCompanyProfileId = favoritePair.companyId;
      }

      return withStatus(manager, await manager.save(project));
    });
  }

  /**
   * Hard delete of a single row. `confirmName` is verified HERE,
   * against the stored row, rather than trusted from the browser —
   * same posture as ClientsService.remove(): a project can carry an
   * unknown number of window designs, so the typed-name friction
   * applies here too now, not just to the client cascade.
   */
  async remove(id: string, confirmName: string): Promise<void> {
    await this.tenantContext.run(async (manager) => {
      const project = await this.findOrFail(manager, id);

      if (confirmName.trim() !== project.enName) {
        throw new BadRequestException(
          'The typed name does not match this project.',
        );
      }

      await manager.remove(project);
    });
    // Deleting the project Free kept clears the pick (B13): with one
    // project left it is editable, with more the admin picks again.
    await this.users.manager.update(
      Company,
      { freeProjectId: id },
      { freeProjectId: null },
    );
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

async function withStatus(
  manager: EntityManager,
  project: Project,
): Promise<ProjectDetail> {
  const latest = await manager.findOne(ProjectStatusEventRow, {
    where: { projectId: project.id },
    order: { at: 'DESC', id: 'DESC' },
    select: { id: true, at: true },
  });
  // Every project has its "created" event; the fallback only covers a
  // row someone deleted by hand.
  return toDetail(project, latest?.at ?? project.createdAt);
}

function toEvent(row: ProjectStatusEventRow): ProjectStatusEvent {
  return {
    id: row.id,
    fromStatusId: row.fromStatusId,
    toStatusId: row.toStatusId,
    enName: row.toEnName,
    arName: row.toArName,
    color: row.toColor as ProjectStatusColor,
    byUserEmail: row.byUserEmail,
    at: row.at.toISOString(),
  };
}

function toDetail(project: Project, statusSince: Date): ProjectDetail {
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
    favoriteFrameProfile: toScopedRef(
      project.favoritePlatformProfileId,
      project.favoriteCompanyProfileId,
    ),
    statusId: project.statusId,
    statusSince: statusSince.toISOString(),
  };
}
