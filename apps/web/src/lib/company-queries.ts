import { useQuery, useQueryClient } from '@tanstack/react-query'
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
