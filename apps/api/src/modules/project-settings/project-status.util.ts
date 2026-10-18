import type { EntityManager } from 'typeorm';
import { ProjectStatusRow } from '../../database/tenant/entities/project-status.entity';
import { ProjectStatusEventRow } from '../../database/tenant/entities/project-status-event.entity';

/**
 * Where a new project starts (docs/project_settings_planing.md S13): the
 * first status, plus its "created" history event. Called inside the same
 * tenant run as the project insert. The list can never be empty: the
 * migration seeds it and the last status can't be deleted.
 */
export async function firstProjectStatus(
  manager: EntityManager,
): Promise<ProjectStatusRow> {
  const [first] = await manager.find(ProjectStatusRow, {
    order: { position: 'ASC' },
    take: 1,
  });
  if (!first) throw new Error('This company has no project statuses.');
  return first;
}

export async function recordProjectCreated(
  manager: EntityManager,
  projectId: string,
  status: ProjectStatusRow,
  by: { id: string; email: string | null },
): Promise<void> {
  await manager.insert(ProjectStatusEventRow, {
    projectId,
    fromStatusId: null,
    toStatusId: status.id,
    toEnName: status.enName,
    toArName: status.arName,
    toColor: status.color,
    byUserId: by.id,
    byUserEmail: by.email,
  });
}
