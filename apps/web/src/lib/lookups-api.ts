import type {
  PaintBrandSummary,
  PaintingPriceSummary,
  ColorSummary,
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
