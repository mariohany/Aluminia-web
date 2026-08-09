import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as leadsApi from '@/lib/leads-api'

const leadsKey = ['leads'] as const

export function useLeadsQuery() {
  return useQuery({ queryKey: leadsKey, queryFn: leadsApi.listLeads })
}

export function useMarkLeadContactedMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => leadsApi.markLeadContacted(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadsKey })
    },
  })
}

export function useDeleteLeadMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => leadsApi.deleteLead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadsKey })
    },
  })
}

export function useDeleteLeadsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => leadsApi.deleteLeads(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadsKey })
    },
  })
}
