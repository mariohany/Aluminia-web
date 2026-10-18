import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import {
  PROJECT_STATUS_LIMITS,
  type CreateProjectStatusInput,
  type ProjectStatus,
  type ProjectStatusColor,
  type UpdateProjectStatusInput,
} from '@repo/types/project-settings';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import { ProjectStatusRow } from '../../database/tenant/entities/project-status.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { translateUniqueViolation } from '../lookups/pg-error.util';
import { isSameIdSet, visibleResponsible } from './project-statuses.rules';

const DUPLICATE_NAME = 'Another status already has that name.';

/**
 * Config › Project settings: the company's project statuses
 * (docs/project_settings_planing.md §3, §4). Positions stay 1…n with no
 * gaps: every write locks the whole list first (`lockAll`), so two admins
 * adding, deleting or reordering at once queue instead of colliding.
 *
 * Responsible users are control-plane users. Writes accept only active
 * users of this company (400 otherwise); reads drop anyone who has since
 * left, moved or been deactivated.
 */
@Injectable()
export class ProjectStatusesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async list(): Promise<ProjectStatus[]> {
    const active = await this.activeUsers();
    return this.tenantContext.run((manager) => listAll(manager, active));
  }

  async create(input: CreateProjectStatusInput): Promise<ProjectStatus> {
    const active = await this.activeUsers();
    const responsibleUserIds = checkResponsible(
      input.responsibleUserIds,
      active,
    );
    try {
      return await this.tenantContext.run(async (manager) => {
        const all = await lockAll(manager);
        if (all.length >= PROJECT_STATUS_LIMITS.statuses) {
          throw new ConflictException(
            `A company can have at most ${PROJECT_STATUS_LIMITS.statuses} statuses.`,
          );
        }
        const row = await manager.save(
          manager.create(ProjectStatusRow, {
            position: all.length + 1,
            enName: input.enName,
            arName: input.arName ?? null,
            color: input.color,
            responsibleUserIds,
          }),
        );
        return toStatus(row, active, 0);
      });
    } catch (error) {
      translateUniqueViolation(error, DUPLICATE_NAME);
    }
  }

  async update(
    id: string,
    input: UpdateProjectStatusInput,
  ): Promise<ProjectStatus> {
    const active = await this.activeUsers();
    const responsibleUserIds =
      input.responsibleUserIds === undefined
        ? undefined
        : checkResponsible(input.responsibleUserIds, active);
    try {
      return await this.tenantContext.run(async (manager) => {
        const row = await findOrFail(manager, id);
        if (input.enName !== undefined) row.enName = input.enName;
        if (input.arName !== undefined) row.arName = input.arName;
        if (input.color !== undefined) row.color = input.color;
        // Saving also drops ids that have stopped being active users.
        row.responsibleUserIds =
          responsibleUserIds ??
          row.responsibleUserIds.filter((userId) => active.has(userId));
        row.updatedAt = new Date();
        const saved = await manager.save(row);
        return toStatus(saved, active, await countProjects(manager, id));
      });
    } catch (error) {
      translateUniqueViolation(error, DUPLICATE_NAME);
    }
  }

  /** Refused while any project is in it (S6), and for the last one. */
  remove(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const all = await lockAll(manager);
      const row = all.find((status) => status.id === id);
      if (!row) throw new NotFoundException('Status not found.');
      if (all.length === 1) {
        throw new ConflictException(
          'A company needs at least one status, so the last one cannot be deleted.',
        );
      }
      const inUse = await countProjects(manager, id);
      if (inUse > 0) {
        throw new ConflictException(
          `${inUse} project${inUse === 1 ? ' is' : 's are'} in this status. Move them first.`,
        );
      }
      await manager.delete(ProjectStatusRow, { id });
      // Close the gap; the position constraint is checked at commit.
      await manager.query(
        `UPDATE "project_statuses" SET "position" = "position" - 1 WHERE "position" > $1`,
        [row.position],
      );
    });
  }

  /** `ids` must be exactly the current statuses (409 otherwise: the list
   * changed since the caller read it). */
  async reorder(ids: string[]): Promise<ProjectStatus[]> {
    const active = await this.activeUsers();
    return this.tenantContext.run(async (manager) => {
      const all = await lockAll(manager);
      if (
        !isSameIdSet(
          all.map((status) => status.id),
          ids,
        )
      ) {
        throw new ConflictException(
          'The status list has changed. Reload it and try again.',
        );
      }
      for (const [index, id] of ids.entries()) {
        await manager.update(ProjectStatusRow, { id }, { position: index + 1 });
      }
      return listAll(manager, active);
    });
  }

  /** id → email of every active user of the request's company. */
  private async activeUsers(): Promise<Map<string, string>> {
    const users = await this.users.find({
      where: {
        companyId: this.tenantContext.tenant.companyId,
        status: UserStatus.ACTIVE,
      },
      select: { id: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user.email]));
  }
}

/** Every responsible id must be an active user of this company. Repeats
 * are dropped, order kept. */
function checkResponsible(
  ids: string[],
  active: ReadonlyMap<string, string>,
): string[] {
  const unique = [...new Set(ids)];
  if (unique.some((id) => !active.has(id))) {
    throw new BadRequestException(
      'Responsible users must be active users of this company.',
    );
  }
  return unique;
}

async function listAll(
  manager: EntityManager,
  active: ReadonlyMap<string, string>,
): Promise<ProjectStatus[]> {
  const [rows, counts] = await Promise.all([
    manager.find(ProjectStatusRow, { order: { position: 'ASC' } }),
    manager
      .createQueryBuilder(Project, 'project')
      .select('project.statusId', 'statusId')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('project.statusId')
      .getRawMany<{ statusId: string; count: number }>(),
  ]);
  const countOf = new Map(counts.map((c) => [c.statusId, c.count]));
  return rows.map((row) => toStatus(row, active, countOf.get(row.id) ?? 0));
}

function lockAll(manager: EntityManager): Promise<ProjectStatusRow[]> {
  return manager.find(ProjectStatusRow, {
    order: { position: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });
}

async function findOrFail(
  manager: EntityManager,
  id: string,
): Promise<ProjectStatusRow> {
  const row = await manager.findOne(ProjectStatusRow, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!row) throw new NotFoundException('Status not found.');
  return row;
}

function countProjects(manager: EntityManager, statusId: string) {
  return manager.count(Project, { where: { statusId } });
}

function toStatus(
  row: ProjectStatusRow,
  active: ReadonlyMap<string, string>,
  projectCount: number,
): ProjectStatus {
  return {
    id: row.id,
    position: row.position,
    enName: row.enName,
    arName: row.arName,
    color: row.color as ProjectStatusColor,
    responsible: visibleResponsible(row.responsibleUserIds, active),
    projectCount,
  };
}
