import type {
  PaintBrandSummary,
  PaintingPriceSummary,
  ColorSummary,
  ColorImportResult,
  BulkDeleteResult,
  CreatePaintBrandInput,
  CreateColorInput,
  CreatePaintingPriceInput,
  CreateGlassCombinationInput,
  CreateGlassInput,
  CreateSystemBrandInput,
  CreateSystemCatalogInput,
  CreateSystemProfileInput,
  GlassCombinationSummary,
  GlassSummary,
  LookupVersion,
  SystemBrandSummary,
  SystemCatalogSummary,
  SystemProfileSummary,
  SystemsImportResult,
  UpdatePaintBrandInput,
  UpdateColorInput,
  UpdatePaintingPriceInput,
  UpdateGlassCombinationInput,
  UpdateGlassInput,
  UpdateSystemBrandInput,
  UpdateSystemCatalogInput,
  UpdateSystemProfileInput,
} from '@repo/types/lookups'
import { apiFetch } from '@/lib/api-client'

export function getLookupVersion(): Promise<LookupVersion> {
  return apiFetch<LookupVersion>('/lookups/version')
}

// Shared by every entity's bulk-select actions — see
// admin-lookups.controller.ts's `*/bulk-delete` and `*/bulk-duplicate`
// routes, both single DB statements so the lookup version advances by
// exactly 1 per bulk action, not once per row (see
// ColorLookupsService.bulkDeleteColors/bulkDuplicateColors).
function bulkDelete(basePath: string, ids: string[]): Promise<BulkDeleteResult> {
  return apiFetch(`${basePath}/bulk-delete`, { method: 'POST', body: { ids } })
}
function bulkDuplicate<TCreate, TSummary>(basePath: string, items: TCreate[]): Promise<TSummary[]> {
  return apiFetch(`${basePath}/bulk-duplicate`, { method: 'POST', body: { items } })
}

// ---- Color ----
export function listColors(): Promise<ColorSummary[]> {
  return apiFetch('/admin/lookups/colors')
}
export function createColor(input: CreateColorInput): Promise<ColorSummary> {
  return apiFetch('/admin/lookups/colors', { method: 'POST', body: input })
}
export function updateColor(id: string, input: UpdateColorInput): Promise<ColorSummary> {
  return apiFetch(`/admin/lookups/colors/${id}`, { method: 'PATCH', body: input })
}
export function deleteColor(id: string): Promise<void> {
  return apiFetch(`/admin/lookups/colors/${id}`, { method: 'DELETE' })
}
export function bulkDeleteColors(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/admin/lookups/colors', ids)
}
export function bulkDuplicateColors(items: CreateColorInput[]): Promise<ColorSummary[]> {
  return bulkDuplicate('/admin/lookups/colors', items)
}
export function importColors(file: File): Promise<ColorImportResult> {
  const body = new FormData()
  body.append('file', file)
  return apiFetch('/admin/lookups/colors/import', { method: 'POST', body })
}

// ---- PaintBrand ----
export function listPaintBrands(): Promise<PaintBrandSummary[]> {
  return apiFetch('/admin/lookups/paint-brands')
}
export function createPaintBrand(input: CreatePaintBrandInput): Promise<PaintBrandSummary> {
  return apiFetch('/admin/lookups/paint-brands', { method: 'POST', body: input })
}
export function updatePaintBrand(id: string, input: UpdatePaintBrandInput): Promise<PaintBrandSummary> {
  return apiFetch(`/admin/lookups/paint-brands/${id}`, { method: 'PATCH', body: input })
}
export function deletePaintBrand(id: string): Promise<void> {
  return apiFetch(`/admin/lookups/paint-brands/${id}`, { method: 'DELETE' })
}

// ---- PaintingPrice ----
export function listPaintingPrices(): Promise<PaintingPriceSummary[]> {
  return apiFetch('/admin/lookups/painting-prices')
}
export function createPaintingPrice(input: CreatePaintingPriceInput): Promise<PaintingPriceSummary> {
  return apiFetch('/admin/lookups/painting-prices', { method: 'POST', body: input })
}
export function updatePaintingPrice(id: string, input: UpdatePaintingPriceInput): Promise<PaintingPriceSummary> {
  return apiFetch(`/admin/lookups/painting-prices/${id}`, { method: 'PATCH', body: input })
}
export function deletePaintingPrice(id: string): Promise<void> {
  return apiFetch(`/admin/lookups/painting-prices/${id}`, { method: 'DELETE' })
}

// ---- Glass ----
export function listGlass(): Promise<GlassSummary[]> {
  return apiFetch('/admin/lookups/glass')
}
export function createGlass(input: CreateGlassInput): Promise<GlassSummary> {
  return apiFetch('/admin/lookups/glass', { method: 'POST', body: input })
}
export function updateGlass(id: string, input: UpdateGlassInput): Promise<GlassSummary> {
  return apiFetch(`/admin/lookups/glass/${id}`, { method: 'PATCH', body: input })
}
export function deleteGlass(id: string): Promise<void> {
  return apiFetch(`/admin/lookups/glass/${id}`, { method: 'DELETE' })
}
export function bulkDeleteGlass(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/admin/lookups/glass', ids)
}
export function bulkDuplicateGlass(items: CreateGlassInput[]): Promise<GlassSummary[]> {
  return bulkDuplicate('/admin/lookups/glass', items)
}

// ---- GlassCombination ----
export function listGlassCombinations(): Promise<GlassCombinationSummary[]> {
  return apiFetch('/admin/lookups/glass-combinations')
}
export function createGlassCombination(
  input: CreateGlassCombinationInput,
): Promise<GlassCombinationSummary> {
  return apiFetch('/admin/lookups/glass-combinations', { method: 'POST', body: input })
}
export function updateGlassCombination(
  id: string,
  input: UpdateGlassCombinationInput,
): Promise<GlassCombinationSummary> {
  return apiFetch(`/admin/lookups/glass-combinations/${id}`, { method: 'PATCH', body: input })
}
export function deleteGlassCombination(id: string): Promise<void> {
  return apiFetch(`/admin/lookups/glass-combinations/${id}`, { method: 'DELETE' })
}
export function bulkDeleteGlassCombinations(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/admin/lookups/glass-combinations', ids)
}
export function bulkDuplicateGlassCombinations(
  items: CreateGlassCombinationInput[],
): Promise<{ created: GlassCombinationSummary[]; failedCount: number }> {
  return apiFetch('/admin/lookups/glass-combinations/bulk-duplicate', { method: 'POST', body: { items } })
}

// ---- SystemBrand ----
export function listSystemBrands(): Promise<SystemBrandSummary[]> {
  return apiFetch('/admin/lookups/system-brands')
}
export function createSystemBrand(input: CreateSystemBrandInput): Promise<SystemBrandSummary> {
  return apiFetch('/admin/lookups/system-brands', { method: 'POST', body: input })
}
export function updateSystemBrand(
  id: string,
  input: UpdateSystemBrandInput,
): Promise<SystemBrandSummary> {
  return apiFetch(`/admin/lookups/system-brands/${id}`, { method: 'PATCH', body: input })
}
export function deleteSystemBrand(id: string): Promise<void> {
  return apiFetch(`/admin/lookups/system-brands/${id}`, { method: 'DELETE' })
}
export function bulkDeleteSystemBrands(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/admin/lookups/system-brands', ids)
}
export function bulkDuplicateSystemBrands(items: CreateSystemBrandInput[]): Promise<SystemBrandSummary[]> {
  return bulkDuplicate('/admin/lookups/system-brands', items)
}

// ---- SystemCatalog ----
export function listSystemCatalogs(): Promise<SystemCatalogSummary[]> {
  return apiFetch('/admin/lookups/system-catalogs')
}
export function createSystemCatalog(input: CreateSystemCatalogInput): Promise<SystemCatalogSummary> {
  return apiFetch('/admin/lookups/system-catalogs', { method: 'POST', body: input })
}
export function updateSystemCatalog(
  id: string,
  input: UpdateSystemCatalogInput,
): Promise<SystemCatalogSummary> {
  return apiFetch(`/admin/lookups/system-catalogs/${id}`, { method: 'PATCH', body: input })
}
export function deleteSystemCatalog(id: string): Promise<void> {
  return apiFetch(`/admin/lookups/system-catalogs/${id}`, { method: 'DELETE' })
}
export function bulkDeleteSystemCatalogs(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/admin/lookups/system-catalogs', ids)
}
export function bulkDuplicateSystemCatalogs(
  items: CreateSystemCatalogInput[],
): Promise<SystemCatalogSummary[]> {
  return bulkDuplicate('/admin/lookups/system-catalogs', items)
}

// ---- SystemProfile ----
export function listSystemProfiles(): Promise<SystemProfileSummary[]> {
  return apiFetch('/admin/lookups/system-profiles')
}
export function createSystemProfile(input: CreateSystemProfileInput): Promise<SystemProfileSummary> {
  return apiFetch('/admin/lookups/system-profiles', { method: 'POST', body: input })
}
export function updateSystemProfile(
  id: string,
  input: UpdateSystemProfileInput,
): Promise<SystemProfileSummary> {
  return apiFetch(`/admin/lookups/system-profiles/${id}`, { method: 'PATCH', body: input })
}
export function deleteSystemProfile(id: string): Promise<void> {
  return apiFetch(`/admin/lookups/system-profiles/${id}`, { method: 'DELETE' })
}
export function bulkDeleteSystemProfiles(ids: string[]): Promise<BulkDeleteResult> {
  return bulkDelete('/admin/lookups/system-profiles', ids)
}
export function bulkDuplicateSystemProfiles(
  items: CreateSystemProfileInput[],
): Promise<SystemProfileSummary[]> {
  return bulkDuplicate('/admin/lookups/system-profiles', items)
}
export function importSystems(file: File): Promise<SystemsImportResult> {
  const body = new FormData()
  body.append('file', file)
  return apiFetch('/admin/lookups/systems/import', { method: 'POST', body })
}
