import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateCompanyUserInput } from '@repo/types/users'
import * as companyUsersApi from '@/lib/company-users-api'
import { invalidateCompanyOverview } from '@/lib/company-queries'

const companyUsersKey = ['company-users'] as const

export function useCompanyUsersQuery() {
  return useQuery({ queryKey: companyUsersKey, queryFn: companyUsersApi.listCompanyUsers })
}

function invalidateCompanyUsers(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: companyUsersKey })
}

export function useCreateCompanyUserMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCompanyUserInput) => companyUsersApi.createCompanyUser(input),
    onSuccess: () => {
      invalidateCompanyUsers(queryClient)
      // A new colleague changes the seat count the "add user" button
      // is gated on.
      invalidateCompanyOverview(queryClient)
    },
  })
}

export function useDeactivateCompanyUserMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => companyUsersApi.deactivateCompanyUser(id),
    onSuccess: () => invalidateCompanyUsers(queryClient),
  })
}

export function useReactivateCompanyUserMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => companyUsersApi.reactivateCompanyUser(id),
    onSuccess: () => invalidateCompanyUsers(queryClient),
  })
}

export function useResetCompanyUserPasswordMutation(id: string) {
  return useMutation({
    mutationFn: (password: string) => companyUsersApi.resetCompanyUserPassword(id, password),
  })
}

export function useDeleteCompanyUserMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (confirmEmail: string) => companyUsersApi.deleteCompanyUser(id, confirmEmail),
    onSuccess: () => {
      invalidateCompanyUsers(queryClient)
      invalidateCompanyOverview(queryClient)
    },
  })
}
