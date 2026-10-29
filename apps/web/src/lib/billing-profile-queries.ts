import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateBillingProfileInput } from '@repo/types/billing-profile'
import * as billingProfileApi from '@/lib/billing-profile-api'

const billingProfileKey = ['billing-profile'] as const

export function useBillingProfileQuery() {
  return useQuery({ queryKey: billingProfileKey, queryFn: billingProfileApi.getBillingProfile })
}

export function useUpdateBillingProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateBillingProfileInput) => billingProfileApi.updateBillingProfile(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(billingProfileKey, profile)
    },
  })
}
