import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateCompanyInput, UpdateCompanyInput } from '@repo/types/companies'
import * as companiesApi from '@/lib/companies-api'

const companiesKey = ['companies'] as const
const companyKey = (id: string) => ['companies', id] as const

export function useCompaniesQuery() {
  return useQuery({ queryKey: companiesKey, queryFn: companiesApi.listCompanies })
}

export function useCompanyQuery(id: string) {
  return useQuery({ queryKey: companyKey(id), queryFn: () => companiesApi.getCompany(id) })
}

export function useCreateCompanyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCompanyInput) => companiesApi.createCompany(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companiesKey })
    },
  })
}

export function useUpdateCompanyMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCompanyInput) => companiesApi.updateCompany(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companiesKey })
      void queryClient.invalidateQueries({ queryKey: companyKey(id) })
    },
  })
}

export function useArchiveCompanyMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => companiesApi.archiveCompany(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companiesKey })
      void queryClient.invalidateQueries({ queryKey: companyKey(id) })
    },
  })
}

export function useReactivateCompanyMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => companiesApi.reactivateCompany(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companiesKey })
      void queryClient.invalidateQueries({ queryKey: companyKey(id) })
    },
  })
}

export function useDeleteCompanyMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (confirmName: string) => companiesApi.deleteCompany(id, confirmName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companiesKey })
      queryClient.removeQueries({ queryKey: companyKey(id) })
    },
  })
}
