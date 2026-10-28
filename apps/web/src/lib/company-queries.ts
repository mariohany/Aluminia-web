import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as companyApi from '@/lib/company-api'

export const companyOverviewKey = ['company', 'me'] as const

export function useCompanyOverviewQuery() {
  return useQuery({ queryKey: companyOverviewKey, queryFn: companyApi.getCompanyOverview })
}

// Company-user mutations import this rather than duplicating the key —
// creating or deleting a colleague changes seatsUsed, which is the
// number this query owns.
export function invalidateCompanyOverview(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: companyOverviewKey })
}

export const companySubscriptionKey = ['company', 'subscription'] as const

// The plan, its features and Free's limits (docs/subscriptions_planing.md
// §7b). Counts change with clients / projects, so their create and delete
// mutations call `invalidateCompanySubscription`; tab focus refetches too,
// which is how a plan changed by the platform admin shows up.
export function useCompanySubscriptionQuery() {
  return useQuery({ queryKey: companySubscriptionKey, queryFn: companyApi.getCompanySubscription })
}

export function invalidateCompanySubscription(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: companySubscriptionKey })
}

/** Free (B13): the company admin picks the one project that stays editable. */
export function usePickFreeProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => companyApi.pickFreeProject(projectId),
    onSuccess: (subscription) => queryClient.setQueryData(companySubscriptionKey, subscription),
  })
}
