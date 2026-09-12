import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateWindowInput, UpdateWindowInput, WindowPanelWindowDetail } from '@repo/types/windows'
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
// its own bulk-duplicate route. `copySuffix` is passed in (translated)
// rather than hardcoded, since a window's name is free-text user data.
export function useDuplicateWindowMutation(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, copySuffix }: { id: string; copySuffix: string }) => {
      const detail = await windowsApi.getWindow(id)
      return windowsApi.createWindow({
        projectId: detail.projectId,
        name: `${detail.name} ${copySuffix}`,
        quantity: detail.quantity,
        // The whole assembly, panel for panel — a duplicate of a
        // three-panel unit is a three-panel unit. `widthMm`/`heightMm`
        // are absent deliberately: the API derives them from these.
        // Window-only for now (docs/transom_tasks.md hasn't reached
        // duplication yet) — same posture as window-editor-page.tsx's own
        // cast for the same reason.
        panels: (detail.panels as WindowPanelWindowDetail[]).map((panel) => ({
          ...panel,
          frameProfile: panel.frameProfile as ScopedRef,
          sashProfile: panel.sashProfile as ScopedRef,
          glass: panel.glass as ScopedRef,
          interiorColor: panel.interiorColor as ScopedRef | null,
          exteriorColor: panel.exteriorColor as ScopedRef | null,
        })),
        location: detail.location,
        notes: detail.notes,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: windowsListKey(projectId) })
    },
  })
}

export function useDeleteWindowMutation(id: string, projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => windowsApi.deleteWindow(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: windowsListKey(projectId) })
    },
  })
}
