import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateUserInput, UpdateUserInput } from '@repo/types/users'
import * as usersApi from '@/lib/users-api'

const usersKey = ['users'] as const

export function useUsersQuery() {
  return useQuery({ queryKey: usersKey, queryFn: usersApi.listUsers })
}

// A user change also moves a company's seat count and user list (the
// Companies page's Seats column, the company page's Users card), so
// ['companies'] — list and every detail under it — refreshes too.
function invalidateUsers(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: usersKey })
  void queryClient.invalidateQueries({ queryKey: ['companies'] })
}

export function useCreateUserMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateUserInput) => usersApi.createUser(input),
    onSuccess: () => invalidateUsers(queryClient),
  })
}

export function useUpdateUserMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateUserInput) => usersApi.updateUser(id, input),
    onSuccess: () => invalidateUsers(queryClient),
  })
}

export function useDeactivateUserMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => usersApi.deactivateUser(id),
    onSuccess: () => invalidateUsers(queryClient),
  })
}

export function useReactivateUserMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => usersApi.reactivateUser(id),
    onSuccess: () => invalidateUsers(queryClient),
  })
}

export function useResetUserPasswordMutation(id: string) {
  return useMutation({
    mutationFn: (password: string) => usersApi.resetUserPassword(id, password),
  })
}

export function useEndUserSessionMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => usersApi.endUserSession(id),
    onSuccess: () => invalidateUsers(queryClient),
  })
}

export function useDeleteUserMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (confirmEmail: string) => usersApi.deleteUser(id, confirmEmail),
    onSuccess: () => invalidateUsers(queryClient),
  })
}
