import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ProfileType,
  SystemType,
  createGlassSchema,
  createSystemBrandSchema,
  createSystemCatalogSchema,
  createSystemProfileSchema,
  updateGlassSchema,
  updateSystemBrandSchema,
  updateSystemCatalogSchema,
  updateSystemProfileSchema,
  type CreateGlassInput,
  type CreateSystemBrandInput,
  type CreateSystemCatalogInput,
  type CreateSystemProfileInput,
} from '@repo/types/lookups'
import * as lookupsApi from '@/lib/lookups-api'
import {
  useCreateGlassMutation,
  useCreateSystemBrandMutation,
  useCreateSystemCatalogMutation,
  useCreateSystemProfileMutation,
  useDeleteGlassMutation,
  useDeleteSystemBrandMutation,
  useDeleteSystemCatalogMutation,
  useDeleteSystemProfileMutation,
  useUpdateGlassMutation,
  useUpdateSystemBrandMutation,
  useUpdateSystemCatalogMutation,
  useUpdateSystemProfileMutation,
} from '@/lib/lookups-queries'
import { useColorsSliceQuery, useGlassSliceQuery, useSystemsSliceQuery } from '@/lib/lookup-slices-queries'
import { LookupTableSection } from '@/components/lookups/lookup-table-section'
import { GlassCombinationSection } from '@/components/lookups/glass-combination-editor'
import { ColorGridSection } from '@/components/lookups/color-grid-section'
import { PaintingPricesSection } from '@/components/lookups/painting-prices-section'

// The Data section's read model: GET /lookups/:slice, the endpoint any
// authenticated user can call (lookups.controller.ts has no @Roles
// guard). Every list below is derived from one of the three cached
// slices rather than the admin-only /admin/lookups/* fetchers those
// same table/section components default to — see lookup-slices-api.ts's
// comment. Phase 2's merged platform+company read model will replace
// these adapters; nothing here assumes company-owned rows exist yet.
function useGlassListFromSlice() {
  const q = useGlassSliceQuery()
  return { data: q.data?.data.glass, isLoading: q.isLoading, isError: q.isError }
}
function useGlassCombinationsFromSlice() {
  const q = useGlassSliceQuery()
  return { data: q.data?.data.combinations, isLoading: q.isLoading, isError: q.isError }
}
function useColorsFromSlice() {
  const q = useColorsSliceQuery()
  return { data: q.data?.data.colors, isLoading: q.isLoading, isError: q.isError }
}
function usePaintBrandsFromSlice() {
  const q = useColorsSliceQuery()
  return { data: q.data?.data.brands, isLoading: q.isLoading, isError: q.isError }
}
function usePaintingPricesFromSlice() {
  const q = useColorsSliceQuery()
  return { data: q.data?.data.prices, isLoading: q.isLoading, isError: q.isError }
}
function useSystemBrandsFromSlice() {
  const q = useSystemsSliceQuery()
  return { data: q.data?.data.brands, isLoading: q.isLoading, isError: q.isError }
}
function useSystemCatalogsFromSlice() {
  const q = useSystemsSliceQuery()
  return { data: q.data?.data.catalogs, isLoading: q.isLoading, isError: q.isError }
}
function useSystemProfilesFromSlice() {
  const q = useSystemsSliceQuery()
  return { data: q.data?.data.profiles, isLoading: q.isLoading, isError: q.isError }
}

// Same tab set and order as the admin Data Warehouse
// (data-warehouse-page.tsx) — one catalogue, two consoles. No version
// badges (there's no version concept for a plain read) and no Excel
// import (admin-only, not asked for here). Every tab is `readOnly`:
// Phase 1 shows the platform catalogue only, nothing here is yet
// company-owned or writable — see docs/company_lookups_planing.md.
const TABS = [
  'systemBrands',
  'systemCatalogs',
  'systemProfiles',
  'glass',
  'glassCombinations',
  'colors',
  'paintingPrices',
] as const
type Tab = (typeof TABS)[number]

export function DataPage() {
  const { t } = useTranslation('lookups')
  const { t: tWorkspace } = useTranslation('workspace')
  const [tab, setTab] = useState<Tab>('systemBrands')

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">{tWorkspace('dataPage.title')}</h1>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((tabId) => (
          <button
            key={tabId}
            type="button"
            className={
              tab === tabId
                ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                : 'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
            }
            onClick={() => setTab(tabId)}
          >
            {t(`tables.${tabId}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'systemBrands' && <SystemBrandsTab />}
        {tab === 'systemCatalogs' && <SystemCatalogsTab />}
        {tab === 'systemProfiles' && <SystemProfilesTab />}
        {tab === 'glass' && <GlassTab />}
        {tab === 'glassCombinations' && (
          <GlassCombinationSection
            readOnly
            useList={useGlassCombinationsFromSlice}
            useGlassList={useGlassListFromSlice}
            useColorList={useColorsFromSlice}
          />
        )}
        {tab === 'colors' && <ColorGridSection readOnly useList={useColorsFromSlice} />}
        {tab === 'paintingPrices' && (
          <PaintingPricesSection
            readOnly
            useBrandsList={usePaintBrandsFromSlice}
            usePricesList={usePaintingPricesFromSlice}
          />
        )}
      </div>
    </div>
  )
}

// The four LookupTableSection tabs below mirror data-warehouse-page.tsx's
// GlassTab/SystemBrandsTab/SystemCatalogsTab/SystemProfilesTab schema-
// for-schema — same fields, columns, search, and filters, since a glass
// row looks the same in both consoles. `useCreate`/`useUpdate`/`useDelete`/
// `bulkDelete`/`bulkDuplicate`/`duplicate`/`toEditDefaults` still point at
// the admin-only mutations: `readOnly` means none of them are ever
// invoked (no dialog or button that would call them ever renders), so
// reusing the real hooks here is harmless — calling a mutation hook only
// registers it, it doesn't fire a request until `.mutateAsync()` is
// called. Only `useList` is swapped for the slice-sourced read, since
// that one actually runs on every render.

function GlassTab() {
  const { t } = useTranslation('lookups')
  const copy = t('bulk.copySuffix')

  return (
    <LookupTableSection
      readOnly
      title={t('tables.glass')}
      createLabel={t('createButtons.glass')}
      emptyLabel={t('empty.glass')}
      errorLabel={t('messages.error')}
      createSchema={createGlassSchema}
      updateSchema={updateGlassSchema}
      createDefaults={{ name: '', thickness: 4, weightPerSqm: 10, pricePerSqm: 0 } as CreateGlassInput}
      fields={[
        { name: 'name', label: t('fields.name'), type: 'text' },
        { name: 'thickness', label: t('fields.thickness'), type: 'number', min: 1 },
        { name: 'weightPerSqm', label: t('fields.weightPerSqm'), type: 'number', step: 0.01, min: 0 },
        { name: 'pricePerSqm', label: t('fields.pricePerSqm'), type: 'number', step: 0.01, min: 0 },
      ]}
      columns={[
        { header: t('fields.name'), cell: (row) => row.name },
        { header: t('fields.thickness'), cell: (row) => row.thickness },
        { header: t('fields.weightPerSqm'), cell: (row) => row.weightPerSqm.toFixed(2) },
        { header: t('fields.pricePerSqm'), cell: (row) => row.pricePerSqm.toFixed(2) },
      ]}
      search={{
        placeholder: t('search.glass'),
        match: (row, query) => row.name.toLowerCase().includes(query.toLowerCase()),
      }}
      useList={useGlassListFromSlice}
      useCreate={useCreateGlassMutation}
      useUpdate={useUpdateGlassMutation}
      useDelete={useDeleteGlassMutation}
      bulkDelete={lookupsApi.bulkDeleteGlass}
      bulkDuplicate={lookupsApi.bulkDuplicateGlass}
      duplicate={(row) => ({
        name: `${row.name} ${copy}`,
        thickness: row.thickness,
        weightPerSqm: row.weightPerSqm,
        pricePerSqm: row.pricePerSqm,
      })}
      toEditDefaults={(row) => ({
        name: row.name,
        thickness: row.thickness,
        weightPerSqm: row.weightPerSqm,
        pricePerSqm: row.pricePerSqm,
      })}
      rowLabel={(row) => row.name}
      deleteWarning={t('deleteWarnings.glass')}
    />
  )
}

function SystemBrandsTab() {
  const { t } = useTranslation('lookups')
  const copy = t('bulk.copySuffix')

  return (
    <LookupTableSection
      readOnly
      title={t('tables.systemBrands')}
      createLabel={t('createButtons.systemBrand')}
      emptyLabel={t('empty.systemBrand')}
      errorLabel={t('messages.error')}
      createSchema={createSystemBrandSchema}
      updateSchema={updateSystemBrandSchema}
      createDefaults={{ name: '' } as CreateSystemBrandInput}
      fields={[{ name: 'name', label: t('fields.name'), type: 'text' }]}
      columns={[{ header: t('fields.name'), cell: (row) => row.name }]}
      search={{
        placeholder: t('search.systemBrands'),
        match: (row, query) => row.name.toLowerCase().includes(query.toLowerCase()),
      }}
      useList={useSystemBrandsFromSlice}
      useCreate={useCreateSystemBrandMutation}
      useUpdate={useUpdateSystemBrandMutation}
      useDelete={useDeleteSystemBrandMutation}
      bulkDelete={lookupsApi.bulkDeleteSystemBrands}
      bulkDuplicate={lookupsApi.bulkDuplicateSystemBrands}
      duplicate={(row) => ({ name: `${row.name} ${copy}` })}
      toEditDefaults={(row) => ({ name: row.name })}
      rowLabel={(row) => row.name}
      deleteWarning={t('deleteWarnings.systemBrand')}
    />
  )
}

function SystemCatalogsTab() {
  const { t } = useTranslation('lookups')
  const copy = t('bulk.copySuffix')
  const { data: brands } = useSystemBrandsFromSlice()
  const brandOptions = (brands ?? []).map((b) => ({ value: b.id, label: b.name }))
  const systemTypeOptions = Object.values(SystemType).map((v) => ({
    value: v,
    label: t(`systemType.${v}`),
  }))

  return (
    <LookupTableSection
      readOnly
      title={t('tables.systemCatalogs')}
      createLabel={t('createButtons.systemCatalog')}
      emptyLabel={t('empty.systemCatalog')}
      errorLabel={t('messages.error')}
      createSchema={createSystemCatalogSchema}
      updateSchema={updateSystemCatalogSchema}
      createDefaults={
        {
          brandId: '',
          name: '',
          systemType: SystemType.SLIDING,
          maxGlassThickness: 24,
          maxSashWeight: 100,
        } as CreateSystemCatalogInput
      }
      fields={[
        { name: 'brandId', label: t('fields.brand'), type: 'select', options: brandOptions },
        { name: 'name', label: t('fields.name'), type: 'text' },
        {
          name: 'systemType',
          label: t('fields.systemType'),
          type: 'select',
          options: systemTypeOptions,
        },
        { name: 'maxGlassThickness', label: t('fields.maxGlassThickness'), type: 'number', min: 1 },
        { name: 'maxSashWeight', label: t('fields.maxSashWeight'), type: 'number', min: 1 },
      ]}
      columns={[
        { header: t('fields.brand'), cell: (row) => row.brandName },
        { header: t('fields.name'), cell: (row) => row.name },
        {
          header: t('fields.systemType'),
          cell: (row) => t(`systemType.${row.systemType}`),
        },
        { header: t('fields.maxGlassThickness'), cell: (row) => row.maxGlassThickness },
        { header: t('fields.maxSashWeight'), cell: (row) => row.maxSashWeight },
      ]}
      search={{
        placeholder: t('search.systemCatalogs'),
        match: (row, query) => {
          const q = query.toLowerCase()
          return row.name.toLowerCase().includes(q) || row.brandName.toLowerCase().includes(q)
        },
      }}
      filters={[
        {
          key: 'brand',
          allLabel: t('filters.allBrands'),
          options: brandOptions,
          match: (row, value) => row.brandId === value,
        },
        {
          key: 'systemType',
          allLabel: t('filters.allTypes'),
          options: systemTypeOptions,
          match: (row, value) => row.systemType === value,
        },
      ]}
      useList={useSystemCatalogsFromSlice}
      useCreate={useCreateSystemCatalogMutation}
      useUpdate={useUpdateSystemCatalogMutation}
      useDelete={useDeleteSystemCatalogMutation}
      bulkDelete={lookupsApi.bulkDeleteSystemCatalogs}
      bulkDuplicate={lookupsApi.bulkDuplicateSystemCatalogs}
      duplicate={(row) => ({
        brandId: row.brandId,
        name: `${row.name} ${copy}`,
        systemType: row.systemType,
        maxGlassThickness: row.maxGlassThickness,
        maxSashWeight: row.maxSashWeight,
      })}
      toEditDefaults={(row) => ({
        brandId: row.brandId,
        name: row.name,
        systemType: row.systemType,
        maxGlassThickness: row.maxGlassThickness,
        maxSashWeight: row.maxSashWeight,
      })}
      rowLabel={(row) => `${row.brandName} · ${row.name}`}
      deleteWarning={t('deleteWarnings.systemCatalog')}
    />
  )
}

function SystemProfilesTab() {
  const { t } = useTranslation('lookups')
  const { data: catalogs } = useSystemCatalogsFromSlice()
  const catalogOptions = (catalogs ?? []).map((c) => ({ value: c.id, label: `${c.brandName} · ${c.name}` }))
  const profileTypeOptions = Object.values(ProfileType).map((v) => ({
    value: v,
    label: t(`profileType.${v}`),
  }))

  return (
    <LookupTableSection
      readOnly
      title={t('tables.systemProfiles')}
      createLabel={t('createButtons.systemProfile')}
      emptyLabel={t('empty.systemProfile')}
      errorLabel={t('messages.error')}
      createSchema={createSystemProfileSchema}
      updateSchema={updateSystemProfileSchema}
      createDefaults={
        {
          catalogId: '',
          profileNo: '',
          profileType: ProfileType.FRAME,
          maxGlassThickness: 24,
          weight: 1,
          perimeter: 100,
          inertiaIx: 1,
          inertiaIy: 1,
          image: null,
        } as CreateSystemProfileInput
      }
      fields={[
        { name: 'catalogId', label: t('fields.catalog'), type: 'select', options: catalogOptions },
        { name: 'profileNo', label: t('fields.profileNo'), type: 'text' },
        {
          name: 'profileType',
          label: t('fields.profileType'),
          type: 'select',
          options: profileTypeOptions,
        },
        { name: 'maxGlassThickness', label: t('fields.maxGlassThickness'), type: 'number', min: 1 },
        { name: 'weight', label: t('fields.weight'), type: 'number', step: 0.01, min: 0 },
        { name: 'perimeter', label: t('fields.perimeter'), type: 'number', min: 1 },
        { name: 'inertiaIx', label: t('fields.inertiaIx'), type: 'number', step: 0.01, min: 0 },
        { name: 'inertiaIy', label: t('fields.inertiaIy'), type: 'number', step: 0.01, min: 0 },
      ]}
      columns={[
        { header: t('fields.catalog'), cell: (row) => row.catalogName },
        { header: t('fields.profileNo'), cell: (row) => row.profileNo },
        {
          header: t('fields.profileType'),
          cell: (row) => t(`profileType.${row.profileType}`),
        },
        { header: t('fields.maxGlassThickness'), cell: (row) => row.maxGlassThickness },
        { header: t('fields.weight'), cell: (row) => row.weight.toFixed(2) },
        { header: t('fields.perimeter'), cell: (row) => row.perimeter },
        { header: t('fields.inertiaIx'), cell: (row) => row.inertiaIx.toFixed(2) },
        { header: t('fields.inertiaIy'), cell: (row) => row.inertiaIy.toFixed(2) },
      ]}
      search={{
        placeholder: t('search.systemProfiles'),
        match: (row, query) => {
          const q = query.toLowerCase()
          return row.profileNo.toLowerCase().includes(q) || row.catalogName.toLowerCase().includes(q)
        },
      }}
      filters={[
        {
          key: 'catalog',
          allLabel: t('filters.allCatalogs'),
          options: catalogOptions,
          match: (row, value) => row.catalogId === value,
        },
        {
          key: 'profileType',
          allLabel: t('filters.allTypes'),
          options: profileTypeOptions,
          match: (row, value) => row.profileType === value,
        },
      ]}
      useList={useSystemProfilesFromSlice}
      useCreate={useCreateSystemProfileMutation}
      useUpdate={useUpdateSystemProfileMutation}
      useDelete={useDeleteSystemProfileMutation}
      bulkDelete={lookupsApi.bulkDeleteSystemProfiles}
      bulkDuplicate={lookupsApi.bulkDuplicateSystemProfiles}
      duplicate={(row) => ({
        catalogId: row.catalogId,
        profileNo: `${row.profileNo}-copy`,
        profileType: row.profileType,
        maxGlassThickness: row.maxGlassThickness,
        weight: row.weight,
        perimeter: row.perimeter,
        inertiaIx: row.inertiaIx,
        inertiaIy: row.inertiaIy,
        image: row.image,
      })}
      toEditDefaults={(row) => ({
        catalogId: row.catalogId,
        profileNo: row.profileNo,
        profileType: row.profileType,
        maxGlassThickness: row.maxGlassThickness,
        weight: row.weight,
        perimeter: row.perimeter,
        inertiaIx: row.inertiaIx,
        inertiaIy: row.inertiaIy,
        image: row.image,
      })}
      rowLabel={(row) => row.profileNo}
    />
  )
}
