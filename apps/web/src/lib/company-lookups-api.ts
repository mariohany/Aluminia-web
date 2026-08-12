import { LookupSlice } from '@repo/types/lookups'
import type { BulkDeleteResult, CreateColorInput, CreateGlassInput, CreatePaintBrandInput, CreateSystemBrandInput, UpdateColorInput, UpdateGlassInput, UpdatePaintBrandInput, UpdateSystemBrandInput } from '@repo/types/lookups'
import type {
  CompanyColorLookups,
  CompanyColorSummary,
  CompanyGlassCombinationSummary,
  CompanyGlassLookups,
  CompanyGlassSummary,
  CompanyPaintBrandSummary,
  CompanyPaintingPriceSummary,
  CompanySystemBrandSummary,
  CompanySystemCatalogSummary,
  CompanySystemLookups,
  CompanySystemProfileSummary,
  CreateCompanyGlassCombinationInput,
  CreateCompanyPaintingPriceInput,
  CreateCompanySystemCatalogInput,
  CreateCompanySystemProfileInput,
  LooseCompanyGlassCombinationInput,
  UpdateCompanyGlassCombinationInput,
  UpdateCompanyPaintingPriceInput,
  UpdateCompanySystemCatalogInput,
  UpdateCompanySystemProfileInput,
} from '@repo/types/company-lookups'
import { apiFetch } from '@/lib/api-client'

export interface CompanyLookupSliceResponse<T> {
  data: T
}

export function getCompanyGlassSlice(): Promise<CompanyLookupSliceResponse<CompanyGlassLookups>> {
  return apiFetch(`/company/lookups/${LookupSlice.GLASS}`)
}
export function getCompanyColorsSlice(): Promise<CompanyLookupSliceResponse<CompanyColorLookups>> {
  return apiFetch(`/company/lookups/${LookupSlice.COLORS}`)
}
export function getCompanySystemsSlice(): Promise<CompanyLookupSliceResponse<CompanySystemLookups>> {
  return apiFetch(`/company/lookups/${LookupSlice.SYSTEMS}`)
}

// Same shared shape as lookups-api.ts's own bulkDelete/bulkDuplicate —
// see that file's comment. Mutations here invalidate `['company-lookups']`
// only, never `['lookups']` (company-lookups-queries.ts) — the platform
// slice is Redis-cached and version-keyed and must not be dropped by a
// tenant write.
function bulkDelete(basePath: string, ids: string[]): Promise<BulkDeleteResult> {
  return apiFetch(`${basePath}/bulk-delete`, { method: 'POST', body: { ids } })
}
function bulkDuplicate<TCreate, TSummary>(basePath: string, items: TCreate[]): Promise<TSummary[]> {
  return apiFetch(`${basePath}/bulk-duplicate`, { method: 'POST', body: { items } })
}

// ---- Color ----
export function createCompanyColor(input: CreateColorInput): Promise<CompanyColorSummary> {
  return apiFetch('/company/lookups/colors', { method: 'POST', body: input })
}
export function updateCompanyColor(id: string, input: UpdateColorInput): Promise<CompanyColorSummary> {
  return apiFetch(`/company/lookups/colors/${id}`, { method: 'PATCH', body: input })
}
export function deleteCompanyColor(id: string): Promise<void> {
  return apiFetch(`/company/lookups/colors/${id}`, { method: 'DELETE' })
}
export function bulkDeleteCompanyColors(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/company/lookups/colors', ids)
}
export function bulkDuplicateCompanyColors(items: CreateColorInput[]): Promise<CompanyColorSummary[]> {
  return bulkDuplicate('/company/lookups/colors', items)
}

// ---- PaintBrand ---- (no bulk — see CompanyColorLookupsService's comment)
export function createCompanyPaintBrand(input: CreatePaintBrandInput): Promise<CompanyPaintBrandSummary> {
  return apiFetch('/company/lookups/paint-brands', { method: 'POST', body: input })
}
export function updateCompanyPaintBrand(id: string, input: UpdatePaintBrandInput): Promise<CompanyPaintBrandSummary> {
  return apiFetch(`/company/lookups/paint-brands/${id}`, { method: 'PATCH', body: input })
}
export function deleteCompanyPaintBrand(id: string): Promise<void> {
  return apiFetch(`/company/lookups/paint-brands/${id}`, { method: 'DELETE' })
}

// ---- PaintingPrice ---- (no bulk)
export function createCompanyPaintingPrice(
  input: CreateCompanyPaintingPriceInput,
): Promise<CompanyPaintingPriceSummary> {
  return apiFetch('/company/lookups/painting-prices', { method: 'POST', body: input })
}
export function updateCompanyPaintingPrice(
  id: string,
  input: UpdateCompanyPaintingPriceInput,
): Promise<CompanyPaintingPriceSummary> {
  return apiFetch(`/company/lookups/painting-prices/${id}`, { method: 'PATCH', body: input })
}
export function deleteCompanyPaintingPrice(id: string): Promise<void> {
  return apiFetch(`/company/lookups/painting-prices/${id}`, { method: 'DELETE' })
}

// ---- Glass ----
export function createCompanyGlass(input: CreateGlassInput): Promise<CompanyGlassSummary> {
  return apiFetch('/company/lookups/glass', { method: 'POST', body: input })
}
export function updateCompanyGlass(id: string, input: UpdateGlassInput): Promise<CompanyGlassSummary> {
  return apiFetch(`/company/lookups/glass/${id}`, { method: 'PATCH', body: input })
}
export function deleteCompanyGlass(id: string): Promise<void> {
  return apiFetch(`/company/lookups/glass/${id}`, { method: 'DELETE' })
}
export function bulkDeleteCompanyGlass(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/company/lookups/glass', ids)
}
export function bulkDuplicateCompanyGlass(items: CreateGlassInput[]): Promise<CompanyGlassSummary[]> {
  return bulkDuplicate('/company/lookups/glass', items)
}

// ---- GlassCombination ----
export function createCompanyGlassCombination(
  input: CreateCompanyGlassCombinationInput,
): Promise<CompanyGlassCombinationSummary> {
  return apiFetch('/company/lookups/glass-combinations', { method: 'POST', body: input })
}
export function updateCompanyGlassCombination(
  id: string,
  input: UpdateCompanyGlassCombinationInput,
): Promise<CompanyGlassCombinationSummary> {
  return apiFetch(`/company/lookups/glass-combinations/${id}`, { method: 'PATCH', body: input })
}
export function deleteCompanyGlassCombination(id: string): Promise<void> {
  return apiFetch(`/company/lookups/glass-combinations/${id}`, { method: 'DELETE' })
}
export function bulkDeleteCompanyGlassCombinations(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/company/lookups/glass-combinations', ids)
}
export function bulkDuplicateCompanyGlassCombinations(
  items: LooseCompanyGlassCombinationInput[],
): Promise<{ created: CompanyGlassCombinationSummary[]; failedCount: number }> {
  return apiFetch('/company/lookups/glass-combinations/bulk-duplicate', { method: 'POST', body: { items } })
}

// ---- SystemBrand ----
export function createCompanySystemBrand(input: CreateSystemBrandInput): Promise<CompanySystemBrandSummary> {
  return apiFetch('/company/lookups/system-brands', { method: 'POST', body: input })
}
export function updateCompanySystemBrand(
  id: string,
  input: UpdateSystemBrandInput,
): Promise<CompanySystemBrandSummary> {
  return apiFetch(`/company/lookups/system-brands/${id}`, { method: 'PATCH', body: input })
}
export function deleteCompanySystemBrand(id: string): Promise<void> {
  return apiFetch(`/company/lookups/system-brands/${id}`, { method: 'DELETE' })
}
export function bulkDeleteCompanySystemBrands(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/company/lookups/system-brands', ids)
}
export function bulkDuplicateCompanySystemBrands(
  items: CreateSystemBrandInput[],
): Promise<CompanySystemBrandSummary[]> {
  return bulkDuplicate('/company/lookups/system-brands', items)
}

// ---- SystemCatalog ----
export function createCompanySystemCatalog(
  input: CreateCompanySystemCatalogInput,
): Promise<CompanySystemCatalogSummary> {
  return apiFetch('/company/lookups/system-catalogs', { method: 'POST', body: input })
}
export function updateCompanySystemCatalog(
  id: string,
  input: UpdateCompanySystemCatalogInput,
): Promise<CompanySystemCatalogSummary> {
  return apiFetch(`/company/lookups/system-catalogs/${id}`, { method: 'PATCH', body: input })
}
export function deleteCompanySystemCatalog(id: string): Promise<void> {
  return apiFetch(`/company/lookups/system-catalogs/${id}`, { method: 'DELETE' })
}
export function bulkDeleteCompanySystemCatalogs(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/company/lookups/system-catalogs', ids)
}
export function bulkDuplicateCompanySystemCatalogs(
  items: CreateCompanySystemCatalogInput[],
): Promise<CompanySystemCatalogSummary[]> {
  return bulkDuplicate('/company/lookups/system-catalogs', items)
}

// ---- SystemProfile ----
export function createCompanySystemProfile(
  input: CreateCompanySystemProfileInput,
): Promise<CompanySystemProfileSummary> {
  return apiFetch('/company/lookups/system-profiles', { method: 'POST', body: input })
}
export function updateCompanySystemProfile(
  id: string,
  input: UpdateCompanySystemProfileInput,
): Promise<CompanySystemProfileSummary> {
  return apiFetch(`/company/lookups/system-profiles/${id}`, { method: 'PATCH', body: input })
}
export function deleteCompanySystemProfile(id: string): Promise<void> {
  return apiFetch(`/company/lookups/system-profiles/${id}`, { method: 'DELETE' })
}
export function bulkDeleteCompanySystemProfiles(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/company/lookups/system-profiles', ids)
}
export function bulkDuplicateCompanySystemProfiles(
  items: CreateCompanySystemProfileInput[],
): Promise<CompanySystemProfileSummary[]> {
  return bulkDuplicate('/company/lookups/system-profiles', items)
}
