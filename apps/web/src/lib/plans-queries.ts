import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdatePlansInput } from '@repo/types/plans'
import * as plansApi from '@/lib/plans-api'

const plansKey = ['plans'] as const

export function usePlansQuery() {
  return useQuery({ queryKey: plansKey, queryFn: plansApi.listPlans })
}

export function useUpdatePlansMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdatePlansInput) => plansApi.updatePlans(input),
    onSuccess: (plans) => {
      queryClient.setQueryData(plansKey, plans)
    },
  })
}
