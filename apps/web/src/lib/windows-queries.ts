import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { freeWindowName } from '@repo/types/windows'
import type { CreateWindowInput, UpdateWindowInput } from '@repo/types/windows'
import type { ScopedRef } from '@repo/types/company-lookups'
import * as windowsApi from '@/lib/windows-api'

export const windowsListKey = (projectId: string) => ['windows', projectId] as const
export const windowKey = (id: string) => ['windows', 'detail', id] as const

export function useWindowsQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: windowsListKey(projectId ?? ''),
    queryFn: () => windowsApi.listWindows(projectId!),
    enabled: !!projectId,
  })
}

export function useWindowQuery(id: string | undefined) {
  return useQuery({
    queryKey: windowKey(id ?? ''),
    queryFn: () => windowsApi.getWindow(id!),
    enabled: !!id,
  })
}

// Every mutation invalidates the project's list — the canvas card grid
// is the only place a window's name/size shows, same reasoning as
// projects-queries.ts invalidating the client tree.
export function useCreateWindowMutation(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateWindowInput) => windowsApi.createWindow(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: windowsListKey(projectId) })
    },
  })
}

export function useUpdateWindowMutation(id: string, projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateWindowInput) => windowsApi.updateWindow(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: windowsListKey(projectId) })
      void queryClient.invalidateQueries({ queryKey: windowKey(id) })
    },
  })
}

// No dedicated backend duplicate endpoint — reads the source window's
// full detail and posts it back as a new create, same composition
// approach as everywhere else in this codebase that duplicates without
// its own bulk-duplicate route. Shared by Duplicate (same project,
// translated "copy" suffix) and Copy to (another project, same name
// unless taken there): `nameOf` maps the source's name to the copy's.
function copyWindow(id: string, nameOf: (sourceName: string) => string, projectId?: string) {
  return windowsApi.getWindow(id).then((detail) =>
    windowsApi.createWindow({
      projectId: projectId ?? detail.projectId,
      name: nameOf(detail.name),
      quantity: detail.quantity,
      // The whole assembly, panel for panel — a duplicate of a
      // three-panel unit is a three-panel unit. `widthMm`/`heightMm`
      // are absent deliberately: the API derives them from these.
      // `WindowPanelDetail`'s own refs are already exactly
      // `ScopedRef`-shaped strings — this just recovers the narrower
      // type this endpoint's input wants.
      panels: detail.panels.map((panel) => ({
        ...panel,
        frameProfile: panel.frameProfile as ScopedRef,
        dividerProfile: panel.dividerProfile as ScopedRef | null,
        interiorColor: panel.interiorColor as ScopedRef | null,
        exteriorColor: panel.exteriorColor as ScopedRef | null,
        sections: panel.sections.map((section) => ({
          ...section,
          sashProfile: section.sashProfile as ScopedRef | null,
          glass: section.glass as ScopedRef,
        })),
      })),
      location: detail.location,
      notes: detail.notes,
    }),
  )
}

/**
 * Duplicates one or more windows (the board's multi-select). One at a
 * time, so the copies land in the same order as their sources. A failed
 * copy doesn't stop the rest — resolves to how many failed (rejects with
 * the first error only when all failed), and the list is refreshed
 * either way since some copies may have been made.
 */
export function useDuplicateWindowsMutation(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, copySuffix }: { ids: string[]; copySuffix: string }) => {
      const errors: unknown[] = []
      for (const id of ids) {
        try {
          await copyWindow(id, (name) => `${name} ${copySuffix}`)
        } catch (err) {
          errors.push(err)
        }
      }
      if (errors.length === ids.length) throw errors[0]
      return { failed: errors.length }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: windowsListKey(projectId) })
    },
  })
}

/**
 * The board's "Copy to": copies windows into ANOTHER project, keeping
 * each name unless the target already has it ("W1 (2)", the same
 * `freeWindowName` the API's move uses). Partial success like
 * Duplicate; resolves to how many were copied / renamed / failed.
 */
export function useCopyWindowsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, projectId }: { ids: string[]; projectId: string }) => {
      const existing = await windowsApi.listWindows(projectId)
      const taken = new Set(existing.map((w) => w.name.toLowerCase()))
      let renamed = 0
      const nameOf = (name: string) => {
        const free = freeWindowName(name, taken)
        if (free !== name) renamed++
        taken.add(free.toLowerCase())
        return free
      }
      const errors: unknown[] = []
      for (const id of ids) {
        try {
          await copyWindow(id, nameOf, projectId)
        } catch (err) {
          errors.push(err)
        }
      }
      if (errors.length === ids.length) throw errors[0]
      return { copied: ids.length - errors.length, renamed, failed: errors.length }
    },
    onSettled: (_data, _error, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: windowsListKey(projectId) })
    },
  })
}

/**
 * The board's "Move to": one request, all or nothing (`POST
 * /windows/move`). Both projects' lists and the moved windows' details
 * change, so every windows query is refreshed.
 */
export function useMoveWindowsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, projectId }: { ids: string[]; projectId: string }) =>
      windowsApi.moveWindows({ windowIds: ids, projectId }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['windows'] })
    },
  })
}

/**
 * Deletes one or more windows, each through the existing single-window
 * route. Partial success is kept: resolves to how many failed (rejects
 * only when every delete failed, with the first error, so a lone
 * window's API message still reaches the toast).
 */
export function useDeleteWindowsMutation(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => windowsApi.deleteWindow(id)))
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (rejected.length === ids.length) throw rejected[0].reason
      return { failed: rejected.length }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: windowsListKey(projectId) })
    },
  })
}
