import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ProfileType,
  SystemType,
  createGlassSchema,
  createSystemBrandSchema,
  updateGlassSchema,
  updateSystemBrandSchema,
  type CreateGlassInput,
  type CreateSystemBrandInput,
} from '@repo/types/lookups'
import {
  LookupScope,
  createCompanySystemCatalogSchema,
  createCompanySystemProfileSchema,
  updateCompanySystemCatalogSchema,
  updateCompanySystemProfileSchema,
  type CreateCompanySystemCatalogInput,
  type CreateCompanySystemProfileInput,
} from '@repo/types/company-lookups'
import * as companyLookupsApi from '@/lib/company-lookups-api'
import {
  useCreateCompanyColorMutation,
  useCreateCompanyGlassMutation,
  useCreateCompanySystemBrandMutation,
  useCreateCompanySystemCatalogMutation,
  useCreateCompanySystemProfileMutation,
  useDeleteCompanyColorMutation,
  useDeleteCompanyGlassMutation,
  useDeleteCompanySystemBrandMutation,
  useDeleteCompanySystemCatalogMutation,
  useDeleteCompanySystemProfileMutation,
  useUpdateCompanyColorMutation,
  useUpdateCompanyGlassMutation,
  useUpdateCompanySystemBrandMutation,
  useUpdateCompanySystemCatalogMutation,
  useUpdateCompanySystemProfileMutation,
} from '@/lib/company-lookups-queries'
import {
  useMergedColorsQuery,
  useMergedGlassCombinationsQuery,
  useMergedGlassQuery,
  useMergedPaintBrandsQuery,
  useMergedPaintingPricesQuery,
  useMergedSystemBrandsQuery,
  useMergedSystemCatalogsQuery,
  useMergedSystemProfilesQuery,
} from '@/lib/lookup-merge'
import { LookupTableSection } from '@/components/lookups/lookup-table-section'
import { GlassCombinationSection } from '@/components/lookups/glass-combination-editor'
import { ColorGridSection } from '@/components/lookups/color-grid-section'
import { PaintingPricesSection } from '@/components/lookups/painting-prices-section'

// Phase 2 (docs/company_lookups_planing.md): every tab now shows the
// platform catalogue AND this company's own rows in one merged table
// (useMergedXQuery, lookup-merge.ts), badged by scope. `canEdit` gates
// every row's actions to `scope === 'company'` — a platform row is
// never writable here, only copyable via `copyToScope`.
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

const isCompanyRow = (row: { scope: LookupScope }) => row.scope === LookupScope.COMPANY

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
        {tab === 'glassCombinations' && <GlassCombinationsTab />}
        {tab === 'colors' && <ColorsTab />}
        {tab === 'paintingPrices' && <PaintingPricesTab />}
      </div>
    </div>
  )
}

function GlassTab() {
  const { t } = useTranslation('lookups')
  const copy = t('bulk.copySuffix')

  return (
    <LookupTableSection
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
      rowScope={(row) => row.scope}
      canEdit={isCompanyRow}
      copyToScope={{
        label: t('scope.copyToOurs'),
        toDefaults: (row) => ({
          name: `${row.name} ${copy}`,
          thickness: row.thickness,
          weightPerSqm: row.weightPerSqm,
          pricePerSqm: row.pricePerSqm,
        }),
      }}
      useList={useMergedGlassQuery}
      useCreate={useCreateCompanyGlassMutation}
      useUpdate={useUpdateCompanyGlassMutation}
      useDelete={useDeleteCompanyGlassMutation}
      bulkDelete={companyLookupsApi.bulkDeleteCompanyGlass}
      bulkDuplicate={companyLookupsApi.bulkDuplicateCompanyGlass}
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
      rowScope={(row) => row.scope}
      canEdit={isCompanyRow}
      copyToScope={{
        label: t('scope.copyToOurs'),
        toDefaults: (row) => ({ name: `${row.name} ${copy}` }),
      }}
      useList={useMergedSystemBrandsQuery}
      useCreate={useCreateCompanySystemBrandMutation}
      useUpdate={useUpdateCompanySystemBrandMutation}
      useDelete={useDeleteCompanySystemBrandMutation}
      bulkDelete={companyLookupsApi.bulkDeleteCompanySystemBrands}
      bulkDuplicate={companyLookupsApi.bulkDuplicateCompanySystemBrands}
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
  const { data: brands } = useMergedSystemBrandsQuery()
  const brandOptions = (brands ?? []).map((b) => ({
    value: `${b.scope}:${b.id}`,
    label: b.scope === LookupScope.COMPANY ? `${b.name} · ${t('scope.ours')}` : b.name,
  }))
  const systemTypeOptions = Object.values(SystemType).map((v) => ({
    value: v,
    label: t(`systemType.${v}`),
  }))

  return (
    <LookupTableSection
      title={t('tables.systemCatalogs')}
      createLabel={t('createButtons.systemCatalog')}
      emptyLabel={t('empty.systemCatalog')}
      errorLabel={t('messages.error')}
      createSchema={createCompanySystemCatalogSchema}
      updateSchema={updateCompanySystemCatalogSchema}
      createDefaults={
        {
          brand: '',
          name: '',
          systemType: SystemType.SLIDING,
          maxGlassThickness: 24,
          maxSashWeight: 100,
        } as CreateCompanySystemCatalogInput
      }
      fields={[
        { name: 'brand', label: t('fields.brand'), type: 'select', options: brandOptions },
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
        {
          header: t('fields.brand'),
          cell: (row) => (row.brandScope === LookupScope.COMPANY ? `${row.brandName} · ${t('scope.ours')}` : row.brandName),
        },
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
          return row.name.toLowerCase().includes(q) || (row.brandName ?? '').toLowerCase().includes(q)
        },
      }}
      filters={[
        {
          key: 'brand',
          allLabel: t('filters.allBrands'),
          options: brandOptions,
          match: (row, value) => row.brand === value,
        },
        {
          key: 'systemType',
          allLabel: t('filters.allTypes'),
          options: systemTypeOptions,
          match: (row, value) => row.systemType === value,
        },
      ]}
      rowScope={(row) => row.scope}
      canEdit={isCompanyRow}
      copyToScope={{
        label: t('scope.copyToOurs'),
        toDefaults: (row) => ({
          brand: row.brand,
          name: `${row.name} ${copy}`,
          systemType: row.systemType,
          maxGlassThickness: row.maxGlassThickness,
          maxSashWeight: row.maxSashWeight,
        }),
      }}
      useList={useMergedSystemCatalogsQuery}
      useCreate={useCreateCompanySystemCatalogMutation}
      useUpdate={useUpdateCompanySystemCatalogMutation}
      useDelete={useDeleteCompanySystemCatalogMutation}
      bulkDelete={companyLookupsApi.bulkDeleteCompanySystemCatalogs}
      bulkDuplicate={companyLookupsApi.bulkDuplicateCompanySystemCatalogs}
      duplicate={(row) => ({
        brand: row.brand,
        name: `${row.name} ${copy}`,
        systemType: row.systemType,
        maxGlassThickness: row.maxGlassThickness,
        maxSashWeight: row.maxSashWeight,
      })}
      toEditDefaults={(row) => ({
        brand: row.brand,
        name: row.name,
        systemType: row.systemType,
        maxGlassThickness: row.maxGlassThickness,
        maxSashWeight: row.maxSashWeight,
      })}
      rowLabel={(row) => `${row.brandName ?? '?'} · ${row.name}`}
      deleteWarning={t('deleteWarnings.systemCatalog')}
    />
  )
}

function SystemProfilesTab() {
  const { t } = useTranslation('lookups')
  const { data: catalogs } = useMergedSystemCatalogsQuery()
  const catalogOptions = (catalogs ?? []).map((c) => ({
    value: `${c.scope}:${c.id}`,
    label:
      c.scope === LookupScope.COMPANY
        ? `${c.brandName} · ${c.name} · ${t('scope.ours')}`
        : `${c.brandName} · ${c.name}`,
  }))
  const profileTypeOptions = Object.values(ProfileType).map((v) => ({
    value: v,
    label: t(`profileType.${v}`),
  }))

  return (
    <LookupTableSection
      title={t('tables.systemProfiles')}
      createLabel={t('createButtons.systemProfile')}
      emptyLabel={t('empty.systemProfile')}
      errorLabel={t('messages.error')}
      createSchema={createCompanySystemProfileSchema}
      updateSchema={updateCompanySystemProfileSchema}
      createDefaults={
        {
          catalog: '',
          profileNo: '',
          profileType: ProfileType.FRAME,
          maxGlassThickness: 24,
          weight: 1,
          perimeter: 100,
          inertiaIx: 1,
          inertiaIy: 1,
          image: null,
          acceptsFlyScreen: false,
        } as CreateCompanySystemProfileInput
      }
      fields={[
        { name: 'catalog', label: t('fields.catalog'), type: 'select', options: catalogOptions },
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
        { name: 'acceptsFlyScreen', label: t('fields.acceptsFlyScreen'), type: 'boolean' },
      ]}
      columns={[
        {
          header: t('fields.catalog'),
          cell: (row) =>
            row.catalogScope === LookupScope.COMPANY ? `${row.catalogName} · ${t('scope.ours')}` : row.catalogName,
        },
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
        {
          header: t('fields.acceptsFlyScreen'),
          cell: (row) => (row.acceptsFlyScreen ? t('common.yes') : t('common.no')),
        },
      ]}
      search={{
        placeholder: t('search.systemProfiles'),
        match: (row, query) => {
          const q = query.toLowerCase()
          return row.profileNo.toLowerCase().includes(q) || (row.catalogName ?? '').toLowerCase().includes(q)
        },
      }}
      filters={[
        {
          key: 'catalog',
          allLabel: t('filters.allCatalogs'),
          options: catalogOptions,
          match: (row, value) => row.catalog === value,
        },
        {
          key: 'profileType',
          allLabel: t('filters.allTypes'),
          options: profileTypeOptions,
          match: (row, value) => row.profileType === value,
        },
      ]}
      rowScope={(row) => row.scope}
      canEdit={isCompanyRow}
      copyToScope={{
        label: t('scope.copyToOurs'),
        toDefaults: (row) => ({
          catalog: row.catalog,
          profileNo: `${row.profileNo}-copy`,
          profileType: row.profileType,
          maxGlassThickness: row.maxGlassThickness,
          weight: row.weight,
          perimeter: row.perimeter,
          inertiaIx: row.inertiaIx,
          inertiaIy: row.inertiaIy,
          image: row.image,
          acceptsFlyScreen: row.acceptsFlyScreen,
        }),
      }}
      useList={useMergedSystemProfilesQuery}
      useCreate={useCreateCompanySystemProfileMutation}
      useUpdate={useUpdateCompanySystemProfileMutation}
      useDelete={useDeleteCompanySystemProfileMutation}
      bulkDelete={companyLookupsApi.bulkDeleteCompanySystemProfiles}
      bulkDuplicate={companyLookupsApi.bulkDuplicateCompanySystemProfiles}
      duplicate={(row) => ({
        catalog: row.catalog,
        profileNo: `${row.profileNo}-copy`,
        profileType: row.profileType,
        maxGlassThickness: row.maxGlassThickness,
        weight: row.weight,
        perimeter: row.perimeter,
        inertiaIx: row.inertiaIx,
        inertiaIy: row.inertiaIy,
        image: row.image,
        acceptsFlyScreen: row.acceptsFlyScreen,
      })}
      toEditDefaults={(row) => ({
        catalog: row.catalog,
        profileNo: row.profileNo,
        profileType: row.profileType,
        maxGlassThickness: row.maxGlassThickness,
        weight: row.weight,
        perimeter: row.perimeter,
        inertiaIx: row.inertiaIx,
        inertiaIy: row.inertiaIy,
        image: row.image,
        acceptsFlyScreen: row.acceptsFlyScreen,
      })}
      rowLabel={(row) => row.profileNo}
    />
  )
}

function GlassCombinationsTab() {
  const { t } = useTranslation('lookups')
  const { data: glass } = useMergedGlassQuery()
  const { data: colors } = useMergedColorsQuery()
  return (
    <GlassCombinationSection
      useList={useMergedGlassCombinationsQuery}
      useGlassList={() => ({ data: glass })}
      useColorList={() => ({ data: colors })}
      scoped
      rowScope={(row) => row.scope}
      canEdit={isCompanyRow}
      copyToScope={{ label: t('scope.copyToOurs') }}
    />
  )
}

function ColorsTab() {
  const { t } = useTranslation('lookups')
  const copy = t('bulk.copySuffix')
  return (
    <ColorGridSection
      useList={useMergedColorsQuery}
      useCreate={useCreateCompanyColorMutation}
      useUpdate={useUpdateCompanyColorMutation}
      useDelete={useDeleteCompanyColorMutation}
      bulkDelete={companyLookupsApi.bulkDeleteCompanyColors}
      bulkDuplicate={companyLookupsApi.bulkDuplicateCompanyColors}
      showImport={false}
      rowScope={(row) => row.scope ?? LookupScope.PLATFORM}
      canEdit={(row) => row.scope === LookupScope.COMPANY}
      copyToScope={{ label: t('scope.copyToOurs'), toDefaults: (row) => ({ code: `${row.code} ${copy}`, hex: row.hex }) }}
    />
  )
}

function PaintingPricesTab() {
  const { t } = useTranslation('lookups')
  return (
    <PaintingPricesSection
      useBrandsList={useMergedPaintBrandsQuery}
      usePricesList={useMergedPaintingPricesQuery}
      scoped
      rowScope={(row) => row.scope}
      canEdit={isCompanyRow}
      copyToScope={{ label: t('scope.copyToOurs') }}
    />
  )
}
