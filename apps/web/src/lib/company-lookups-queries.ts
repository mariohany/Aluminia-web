import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateColorInput, CreateGlassInput, CreatePaintBrandInput, CreateSystemBrandInput, UpdateColorInput, UpdateGlassInput, UpdatePaintBrandInput, UpdateSystemBrandInput } from '@repo/types/lookups'
import type {
  CreateCompanyGlassCombinationInput,
  CreateCompanyPaintingPriceInput,
  CreateCompanySystemCatalogInput,
  CreateCompanySystemProfileInput,
  UpdateCompanyGlassCombinationInput,
  UpdateCompanyPaintingPriceInput,
  UpdateCompanySystemCatalogInput,
  UpdateCompanySystemProfileInput,
} from '@repo/types/company-lookups'
import * as api from '@/lib/company-lookups-api'

// Mirrors lookups-queries.ts's shape exactly, one level namespaced under
// 'company-lookups' — so a bulk action's `invalidateQueries({ queryKey:
// ['company-lookups'] })` (LookupTableSection) only ever retires this
// tenant's own cache, never the platform's Redis-backed, version-keyed
// one (['lookups']).
export const companyColorsSliceKey = ['company-lookups', 'slice', 'colors'] as const
export const companyGlassSliceKey = ['company-lookups', 'slice', 'glass'] as const
export const companySystemsSliceKey = ['company-lookups', 'slice', 'systems'] as const

export function useCompanyColorsSliceQuery() {
  return useQuery({ queryKey: companyColorsSliceKey, queryFn: api.getCompanyColorsSlice })
}
export function useCompanyGlassSliceQuery() {
  return useQuery({ queryKey: companyGlassSliceKey, queryFn: api.getCompanyGlassSlice })
}
export function useCompanySystemsSliceQuery() {
  return useQuery({ queryKey: companySystemsSliceKey, queryFn: api.getCompanySystemsSlice })
}

// ---- Color ----
export function useCreateCompanyColorMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateColorInput) => api.createCompanyColor(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}
export function useUpdateCompanyColorMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateColorInput) => api.updateCompanyColor(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}
export function useDeleteCompanyColorMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteCompanyColor(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}

// ---- PaintBrand ----
export function useCreateCompanyPaintBrandMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePaintBrandInput) => api.createCompanyPaintBrand(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}
export function useUpdateCompanyPaintBrandMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdatePaintBrandInput) => api.updateCompanyPaintBrand(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}
export function useDeleteCompanyPaintBrandMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteCompanyPaintBrand(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}

// ---- PaintingPrice ----
export function useCreateCompanyPaintingPriceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCompanyPaintingPriceInput) => api.createCompanyPaintingPrice(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}
export function useUpdateCompanyPaintingPriceMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCompanyPaintingPriceInput) => api.updateCompanyPaintingPrice(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}
export function useDeleteCompanyPaintingPriceMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteCompanyPaintingPrice(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyColorsSliceKey }),
  })
}

// ---- Glass ----
export function useCreateCompanyGlassMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGlassInput) => api.createCompanyGlass(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyGlassSliceKey }),
  })
}
export function useUpdateCompanyGlassMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateGlassInput) => api.updateCompanyGlass(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyGlassSliceKey }),
  })
}
export function useDeleteCompanyGlassMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteCompanyGlass(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyGlassSliceKey }),
  })
}

// ---- GlassCombination ----
export function useCreateCompanyGlassCombinationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCompanyGlassCombinationInput) => api.createCompanyGlassCombination(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyGlassSliceKey }),
  })
}
export function useUpdateCompanyGlassCombinationMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCompanyGlassCombinationInput) => api.updateCompanyGlassCombination(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyGlassSliceKey }),
  })
}
export function useDeleteCompanyGlassCombinationMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteCompanyGlassCombination(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companyGlassSliceKey }),
  })
}

// ---- SystemBrand ----
export function useCreateCompanySystemBrandMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSystemBrandInput) => api.createCompanySystemBrand(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}
export function useUpdateCompanySystemBrandMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateSystemBrandInput) => api.updateCompanySystemBrand(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}
export function useDeleteCompanySystemBrandMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteCompanySystemBrand(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}

// ---- SystemCatalog ----
export function useCreateCompanySystemCatalogMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCompanySystemCatalogInput) => api.createCompanySystemCatalog(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}
export function useUpdateCompanySystemCatalogMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCompanySystemCatalogInput) => api.updateCompanySystemCatalog(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}
export function useDeleteCompanySystemCatalogMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteCompanySystemCatalog(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}

// ---- SystemProfile ----
export function useCreateCompanySystemProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCompanySystemProfileInput) => api.createCompanySystemProfile(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}
export function useUpdateCompanySystemProfileMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCompanySystemProfileInput) => api.updateCompanySystemProfile(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}
export function useDeleteCompanySystemProfileMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteCompanySystemProfile(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: companySystemsSliceKey }),
  })
}
