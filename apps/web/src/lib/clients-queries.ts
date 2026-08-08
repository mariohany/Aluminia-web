import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateClientInput, UpdateClientInput } from '@repo/types/clients'
import * as clientsApi from '@/lib/clients-api'

// The tree's key. Project mutations invalidate this too — a new project
// changes the tree, not just the project.
export const clientTreeKey = ['clients'] as const
export const clientKey = (id: string) => ['clients', id] as const

export function useClientTreeQuery() {
  return useQuery({ queryKey: clientTreeKey, queryFn: clientsApi.listClientTree })
}

export function useClientQuery(id: string | undefined) {
  return useQuery({
    queryKey: clientKey(id ?? ''),
    queryFn: () => clientsApi.getClient(id!),
    enabled: !!id,
  })
}

export function useCreateClientMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateClientInput) => clientsApi.createClient(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientTreeKey })
    },
  })
}

export function useUpdateClientMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateClientInput) => clientsApi.updateClient(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientTreeKey })
      void queryClient.invalidateQueries({ queryKey: clientKey(id) })
    },
  })
}

export function useDeleteClientMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (confirmName: string) => clientsApi.deleteClient(id, confirmName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientTreeKey })
    },
  })
}
