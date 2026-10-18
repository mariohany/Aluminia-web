import type { ProjectStatusUser } from '@repo/types/project-settings';

/**
 * Pure rules behind `ProjectStatusesService`, kept apart so they are unit
 * tested without a database (docs/project_settings_planing.md §3, §4).
 */

/** The responsible users a status shows: only ids that are still active
 * users of this company, in the stored order. Removed, moved and
 * deactivated users simply drop out (no FK can do it across schemas). */
export function visibleResponsible(
  storedIds: readonly string[],
  activeUsers: ReadonlyMap<string, string>,
): ProjectStatusUser[] {
  return storedIds.flatMap((id) => {
    const email = activeUsers.get(id);
    return email ? [{ id, email }] : [];
  });
}

/** A reorder is valid only when it names exactly the current statuses,
 * each once; anything else means the list changed under the caller. */
export function isSameIdSet(
  current: readonly string[],
  next: readonly string[],
): boolean {
  if (current.length !== next.length) return false;
  const wanted = new Set(next);
  return wanted.size === next.length && current.every((id) => wanted.has(id));
}
