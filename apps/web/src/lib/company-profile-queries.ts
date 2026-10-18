import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateCompanyProfileInput } from '@repo/types/company-profile'
import * as companyProfileApi from '@/lib/company-profile-api'

export const companyProfileKey = ['company-profile'] as const

export function useCompanyProfileQuery() {
  return useQuery({ queryKey: companyProfileKey, queryFn: companyProfileApi.getCompanyProfile })
}

// The response is the saved profile, so it replaces the cache directly.
// Reports read the profile server-side; their own status query notices
// the change (stale) on its next fetch.
export function useUpdateCompanyProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCompanyProfileInput) => companyProfileApi.updateCompanyProfile(input),
    onSuccess: (profile) => queryClient.setQueryData(companyProfileKey, profile),
  })
}
