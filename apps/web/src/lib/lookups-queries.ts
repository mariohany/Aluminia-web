import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateColorBrandInput,
  CreateColorInput,
  CreateColorPriceInput,
  CreateGlassCombinationInput,
  CreateGlassInput,
  CreateSystemBrandInput,
  CreateSystemCatalogInput,
  CreateSystemProfileInput,
  UpdateColorBrandInput,
  UpdateColorInput,
  UpdateColorPriceInput,
  UpdateGlassCombinationInput,
  UpdateGlassInput,
  UpdateSystemBrandInput,
  UpdateSystemCatalogInput,
  UpdateSystemProfileInput,
} from '@repo/types/lookups'
import * as api from '@/lib/lookups-api'

const versionKey = ['lookups', 'version'] as const
const colorsKey = ['lookups', 'colors'] as const
const colorBrandsKey = ['lookups', 'color-brands'] as const
const colorPricesKey = ['lookups', 'color-prices'] as const
const glassKey = ['lookups', 'glass'] as const
const glassCombinationsKey = ['lookups', 'glass-combinations'] as const
const systemBrandsKey = ['lookups', 'system-brands'] as const
const systemCatalogsKey = ['lookups', 'system-catalogs'] as const
const systemProfilesKey = ['lookups', 'system-profiles'] as const

export function useLookupVersionQuery() {
  return useQuery({ queryKey: versionKey, queryFn: api.getLookupVersion, refetchOnWindowFocus: true })
}

// A write to any lookup table bumps the single shared version counter
// (Section 4), so every mutation below also invalidates it — the version
// badge should never show a stale number after a save.
function invalidateVersion(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: versionKey })
}

// ---- Color ----
export function useColorsQuery() {
  return useQuery({ queryKey: colorsKey, queryFn: api.listColors })
}
export function useCreateColorMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateColorInput) => api.createColor(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useUpdateColorMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateColorInput) => api.updateColor(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useDeleteColorMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteColor(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorsKey })
      invalidateVersion(queryClient)
    },
  })
}

// ---- ColorBrand ----
export function useColorBrandsQuery() {
  return useQuery({ queryKey: colorBrandsKey, queryFn: api.listColorBrands })
}
export function useCreateColorBrandMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateColorBrandInput) => api.createColorBrand(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorBrandsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useUpdateColorBrandMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateColorBrandInput) => api.updateColorBrand(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorBrandsKey })
      // Prices display brandName, so a brand rename should refresh them too.
      void queryClient.invalidateQueries({ queryKey: colorPricesKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useDeleteColorBrandMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteColorBrand(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorBrandsKey })
      invalidateVersion(queryClient)
    },
  })
}

// ---- ColorPrice ----
export function useColorPricesQuery() {
  return useQuery({ queryKey: colorPricesKey, queryFn: api.listColorPrices })
}
export function useCreateColorPriceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateColorPriceInput) => api.createColorPrice(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorPricesKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useUpdateColorPriceMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateColorPriceInput) => api.updateColorPrice(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorPricesKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useDeleteColorPriceMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteColorPrice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: colorPricesKey })
      invalidateVersion(queryClient)
    },
  })
}

// ---- Glass ----
export function useGlassQuery() {
  return useQuery({ queryKey: glassKey, queryFn: api.listGlass })
}
export function useCreateGlassMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGlassInput) => api.createGlass(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: glassKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useUpdateGlassMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateGlassInput) => api.updateGlass(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: glassKey })
      void queryClient.invalidateQueries({ queryKey: glassCombinationsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useDeleteGlassMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteGlass(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: glassKey })
      invalidateVersion(queryClient)
    },
  })
}

// ---- GlassCombination ----
export function useGlassCombinationsQuery() {
  return useQuery({ queryKey: glassCombinationsKey, queryFn: api.listGlassCombinations })
}
export function useCreateGlassCombinationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGlassCombinationInput) => api.createGlassCombination(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: glassCombinationsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useUpdateGlassCombinationMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateGlassCombinationInput) => api.updateGlassCombination(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: glassCombinationsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useDeleteGlassCombinationMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteGlassCombination(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: glassCombinationsKey })
      invalidateVersion(queryClient)
    },
  })
}

// ---- SystemBrand ----
export function useSystemBrandsQuery() {
  return useQuery({ queryKey: systemBrandsKey, queryFn: api.listSystemBrands })
}
export function useCreateSystemBrandMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSystemBrandInput) => api.createSystemBrand(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemBrandsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useUpdateSystemBrandMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateSystemBrandInput) => api.updateSystemBrand(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemBrandsKey })
      void queryClient.invalidateQueries({ queryKey: systemCatalogsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useDeleteSystemBrandMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteSystemBrand(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemBrandsKey })
      invalidateVersion(queryClient)
    },
  })
}

// ---- SystemCatalog ----
export function useSystemCatalogsQuery() {
  return useQuery({ queryKey: systemCatalogsKey, queryFn: api.listSystemCatalogs })
}
export function useCreateSystemCatalogMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSystemCatalogInput) => api.createSystemCatalog(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemCatalogsKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useUpdateSystemCatalogMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateSystemCatalogInput) => api.updateSystemCatalog(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemCatalogsKey })
      void queryClient.invalidateQueries({ queryKey: systemProfilesKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useDeleteSystemCatalogMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteSystemCatalog(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemCatalogsKey })
      invalidateVersion(queryClient)
    },
  })
}

// ---- SystemProfile ----
export function useSystemProfilesQuery() {
  return useQuery({ queryKey: systemProfilesKey, queryFn: api.listSystemProfiles })
}
export function useCreateSystemProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSystemProfileInput) => api.createSystemProfile(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemProfilesKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useUpdateSystemProfileMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateSystemProfileInput) => api.updateSystemProfile(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemProfilesKey })
      invalidateVersion(queryClient)
    },
  })
}
export function useDeleteSystemProfileMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteSystemProfile(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemProfilesKey })
      invalidateVersion(queryClient)
    },
  })
}
