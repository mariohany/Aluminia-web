import { useMemo } from 'react'
import { CombinationItemKind } from '@repo/types/lookups'
import type {
  ColorSummary,
  GlassCombinationItemSummary,
  GlassCombinationSummary,
  GlassSummary,
  PaintBrandSummary,
  PaintingPriceSummary,
  SystemBrandSummary,
  SystemCatalogSummary,
  SystemProfileSummary,
} from '@repo/types/lookups'
import { LookupScope, formatScopedRef } from '@repo/types/company-lookups'
import type {
  CompanyColorSummary,
  CompanyGlassCombinationItemSummary,
  CompanyGlassCombinationSummary,
  CompanyGlassSummary,
  CompanyPaintBrandSummary,
  CompanyPaintingPriceSummary,
  CompanySystemBrandSummary,
  CompanySystemCatalogSummary,
  CompanySystemProfileSummary,
} from '@repo/types/company-lookups'
import type { LookupRowScope } from '@/components/lookups/lookup-table-section'
import { useColorsSliceQuery, useGlassSliceQuery, useSystemsSliceQuery } from '@/lib/lookup-slices-queries'
import {
  useCompanyColorsSliceQuery,
  useCompanyGlassSliceQuery,
  useCompanySystemsSliceQuery,
} from '@/lib/company-lookups-queries'

// Phase 2's read model: unions the platform slice (Redis-cached,
// version-keyed) with this tenant's own company slice (uncached), tags
// every row with which scope it came from, and — for the four entities
// with a parent reference — resolves that reference into the same
// { brand, brandName, brandScope } shape regardless of which scope the
// row itself is in, so a platform row and a company row render through
// one set of table columns. See docs/company_lookups_planing.md,
// "Frontend: a merge, not a second read path".

export type MergedColorSummary = ColorSummary & { scope: LookupRowScope }
export type MergedPaintBrandSummary = PaintBrandSummary & { scope: LookupRowScope }
export type MergedGlassSummary = GlassSummary & { scope: LookupRowScope }
export type MergedSystemBrandSummary = SystemBrandSummary & { scope: LookupRowScope }
export type MergedPaintingPriceSummary = Omit<CompanyPaintingPriceSummary, 'scope'> & { scope: LookupRowScope }
export type MergedSystemCatalogSummary = Omit<CompanySystemCatalogSummary, 'scope'> & { scope: LookupRowScope }
export type MergedSystemProfileSummary = Omit<CompanySystemProfileSummary, 'scope'> & { scope: LookupRowScope }
export type MergedGlassCombinationItemSummary = CompanyGlassCombinationItemSummary
export type MergedGlassCombinationSummary = Omit<CompanyGlassCombinationSummary, 'scope' | 'items'> & {
  scope: LookupRowScope
  items: MergedGlassCombinationItemSummary[]
}

const platformColorToMerged = (row: ColorSummary): MergedColorSummary => ({ ...row, scope: LookupScope.PLATFORM })
const companyColorToMerged = (row: CompanyColorSummary): MergedColorSummary => ({ ...row, scope: LookupScope.COMPANY })

// Exported: painting-prices-section.tsx's admin (platform-only) default
// list hooks wrap admin's plain queries through these same transforms —
// see that file's comment.
export const platformBrandToMerged = (row: PaintBrandSummary): MergedPaintBrandSummary => ({
  ...row,
  scope: LookupScope.PLATFORM,
})
const companyBrandToMerged = (row: CompanyPaintBrandSummary): MergedPaintBrandSummary => ({
  ...row,
  scope: LookupScope.COMPANY,
})

export const platformPriceToMerged = (row: PaintingPriceSummary): MergedPaintingPriceSummary => ({
  id: row.id,
  brand: formatScopedRef(LookupScope.PLATFORM, row.brandId),
  brandName: row.brandName,
  brandScope: LookupScope.PLATFORM,
  type: row.type,
  price: row.price,
  scope: LookupScope.PLATFORM,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
const companyPriceToMerged = (row: CompanyPaintingPriceSummary): MergedPaintingPriceSummary => ({
  ...row,
  scope: LookupScope.COMPANY,
})

const platformGlassToMerged = (row: GlassSummary): MergedGlassSummary => ({ ...row, scope: LookupScope.PLATFORM })
const companyGlassToMerged = (row: CompanyGlassSummary): MergedGlassSummary => ({ ...row, scope: LookupScope.COMPANY })

// Exported: glass-combination-editor.tsx's admin (platform-only) default
// `useList` wraps admin's plain query through this same transform, so a
// combination's ScopedRef-shaped items are always the internal shape the
// editor works with — see that file's comment.
export function platformComboItemToMerged(item: GlassCombinationItemSummary): MergedGlassCombinationItemSummary {
  if (item.kind === CombinationItemKind.SHEET) {
    return {
      kind: CombinationItemKind.SHEET,
      position: item.position,
      glass: formatScopedRef(LookupScope.PLATFORM, item.glassId),
      glassName: item.glassName,
      glassScope: LookupScope.PLATFORM,
      glassThickness: item.glassThickness,
      color: item.colorId ? formatScopedRef(LookupScope.PLATFORM, item.colorId) : null,
      colorCode: item.colorCode,
      colorScope: item.colorId ? LookupScope.PLATFORM : null,
    }
  }
  return {
    kind: CombinationItemKind.GAP,
    position: item.position,
    gapType: item.gapType,
    gapThickness: item.gapThickness,
    gapColor: item.gapColorId ? formatScopedRef(LookupScope.PLATFORM, item.gapColorId) : null,
    colorCode: item.colorCode,
    colorScope: item.gapColorId ? LookupScope.PLATFORM : null,
    isGeorgian: item.isGeorgian,
    columnsCount: item.columnsCount,
    rowsCount: item.rowsCount,
  }
}
export const platformComboToMerged = (row: GlassCombinationSummary): MergedGlassCombinationSummary => ({
  id: row.id,
  name: row.name,
  totalThickness: row.totalThickness,
  items: row.items.map(platformComboItemToMerged),
  scope: LookupScope.PLATFORM,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
const companyComboToMerged = (row: CompanyGlassCombinationSummary): MergedGlassCombinationSummary => ({
  ...row,
  scope: LookupScope.COMPANY,
})

const platformSystemBrandToMerged = (row: SystemBrandSummary): MergedSystemBrandSummary => ({
  ...row,
  scope: LookupScope.PLATFORM,
})
const companySystemBrandToMerged = (row: CompanySystemBrandSummary): MergedSystemBrandSummary => ({
  ...row,
  scope: LookupScope.COMPANY,
})

const platformCatalogToMerged = (row: SystemCatalogSummary): MergedSystemCatalogSummary => ({
  id: row.id,
  brand: formatScopedRef(LookupScope.PLATFORM, row.brandId),
  brandName: row.brandName,
  brandScope: LookupScope.PLATFORM,
  name: row.name,
  systemType: row.systemType,
  maxGlassThickness: row.maxGlassThickness,
  maxSashWeight: row.maxSashWeight,
  scope: LookupScope.PLATFORM,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
const companyCatalogToMerged = (row: CompanySystemCatalogSummary): MergedSystemCatalogSummary => ({
  ...row,
  scope: LookupScope.COMPANY,
})

const platformProfileToMerged = (row: SystemProfileSummary): MergedSystemProfileSummary => ({
  id: row.id,
  catalog: formatScopedRef(LookupScope.PLATFORM, row.catalogId),
  catalogName: row.catalogName,
  catalogScope: LookupScope.PLATFORM,
  profileNo: row.profileNo,
  profileType: row.profileType,
  maxGlassThickness: row.maxGlassThickness,
  weight: row.weight,
  perimeter: row.perimeter,
  inertiaIx: row.inertiaIx,
  inertiaIy: row.inertiaIy,
  image: row.image,
  scope: LookupScope.PLATFORM,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
const companyProfileToMerged = (row: CompanySystemProfileSummary): MergedSystemProfileSummary => ({
  ...row,
  scope: LookupScope.COMPANY,
})

interface MergedResult<T> {
  data: T[] | undefined
  isLoading: boolean
  isError: boolean
}

export function useMergedColorsQuery(): MergedResult<MergedColorSummary> {
  const platform = useColorsSliceQuery()
  const company = useCompanyColorsSliceQuery()
  const data = useMemo(() => {
    if (!platform.data || !company.data) return undefined
    return [
      ...platform.data.data.colors.map(platformColorToMerged),
      ...company.data.data.colors.map(companyColorToMerged),
    ]
  }, [platform.data, company.data])
  return { data, isLoading: platform.isLoading || company.isLoading, isError: platform.isError || company.isError }
}

export function useMergedPaintBrandsQuery(): MergedResult<MergedPaintBrandSummary> {
  const platform = useColorsSliceQuery()
  const company = useCompanyColorsSliceQuery()
  const data = useMemo(() => {
    if (!platform.data || !company.data) return undefined
    return [
      ...platform.data.data.brands.map(platformBrandToMerged),
      ...company.data.data.brands.map(companyBrandToMerged),
    ]
  }, [platform.data, company.data])
  return { data, isLoading: platform.isLoading || company.isLoading, isError: platform.isError || company.isError }
}

export function useMergedPaintingPricesQuery(): MergedResult<MergedPaintingPriceSummary> {
  const platform = useColorsSliceQuery()
  const company = useCompanyColorsSliceQuery()
  const data = useMemo(() => {
    if (!platform.data || !company.data) return undefined
    return [
      ...platform.data.data.prices.map(platformPriceToMerged),
      ...company.data.data.prices.map(companyPriceToMerged),
    ]
  }, [platform.data, company.data])
  return { data, isLoading: platform.isLoading || company.isLoading, isError: platform.isError || company.isError }
}

export function useMergedGlassQuery(): MergedResult<MergedGlassSummary> {
  const platform = useGlassSliceQuery()
  const company = useCompanyGlassSliceQuery()
  const data = useMemo(() => {
    if (!platform.data || !company.data) return undefined
    return [
      ...platform.data.data.glass.map(platformGlassToMerged),
      ...company.data.data.glass.map(companyGlassToMerged),
    ]
  }, [platform.data, company.data])
  return { data, isLoading: platform.isLoading || company.isLoading, isError: platform.isError || company.isError }
}

export function useMergedGlassCombinationsQuery(): MergedResult<MergedGlassCombinationSummary> {
  const platform = useGlassSliceQuery()
  const company = useCompanyGlassSliceQuery()
  const data = useMemo(() => {
    if (!platform.data || !company.data) return undefined
    return [
      ...platform.data.data.combinations.map(platformComboToMerged),
      ...company.data.data.combinations.map(companyComboToMerged),
    ]
  }, [platform.data, company.data])
  return { data, isLoading: platform.isLoading || company.isLoading, isError: platform.isError || company.isError }
}

export function useMergedSystemBrandsQuery(): MergedResult<MergedSystemBrandSummary> {
  const platform = useSystemsSliceQuery()
  const company = useCompanySystemsSliceQuery()
  const data = useMemo(() => {
    if (!platform.data || !company.data) return undefined
    return [
      ...platform.data.data.brands.map(platformSystemBrandToMerged),
      ...company.data.data.brands.map(companySystemBrandToMerged),
    ]
  }, [platform.data, company.data])
  return { data, isLoading: platform.isLoading || company.isLoading, isError: platform.isError || company.isError }
}

export function useMergedSystemCatalogsQuery(): MergedResult<MergedSystemCatalogSummary> {
  const platform = useSystemsSliceQuery()
  const company = useCompanySystemsSliceQuery()
  const data = useMemo(() => {
    if (!platform.data || !company.data) return undefined
    return [
      ...platform.data.data.catalogs.map(platformCatalogToMerged),
      ...company.data.data.catalogs.map(companyCatalogToMerged),
    ]
  }, [platform.data, company.data])
  return { data, isLoading: platform.isLoading || company.isLoading, isError: platform.isError || company.isError }
}

export function useMergedSystemProfilesQuery(): MergedResult<MergedSystemProfileSummary> {
  const platform = useSystemsSliceQuery()
  const company = useCompanySystemsSliceQuery()
  const data = useMemo(() => {
    if (!platform.data || !company.data) return undefined
    return [
      ...platform.data.data.profiles.map(platformProfileToMerged),
      ...company.data.data.profiles.map(companyProfileToMerged),
    ]
  }, [platform.data, company.data])
  return { data, isLoading: platform.isLoading || company.isLoading, isError: platform.isError || company.isError }
}
