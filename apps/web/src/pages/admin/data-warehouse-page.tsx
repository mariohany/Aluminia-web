import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LookupEntity,
  ProfileType,
  SystemType,
  type CreateGlassInput,
  type CreateSystemBrandInput,
  type CreateSystemCatalogInput,
  type CreateSystemProfileInput,
} from '@repo/types/lookups'
import {
  createGlassSchema,
  createSystemBrandSchema,
  createSystemCatalogSchema,
  createSystemProfileSchema,
  updateGlassSchema,
  updateSystemBrandSchema,
  updateSystemCatalogSchema,
  updateSystemProfileSchema,
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
  useGlassQuery,
  useLookupVersionQuery,
  useSystemBrandsQuery,
  useSystemCatalogsQuery,
  useSystemProfilesQuery,
  useUpdateGlassMutation,
  useUpdateSystemBrandMutation,
  useUpdateSystemCatalogMutation,
  useUpdateSystemProfileMutation,
} from '@/lib/lookups-queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SimpleLookupSection } from '@/components/admin/lookups/simple-lookup-section'
import { GlassCombinationSection } from '@/components/admin/lookups/glass-combination-editor'
import { ColorGridSection } from '@/components/admin/lookups/color-grid-section'
import { SystemsImportButton } from '@/components/admin/lookups/systems-import-button'
import { PaintingPricesSection } from '@/components/admin/lookups/painting-prices-section'

// Order requested: systems (brand → catalog → profile), then glass and
// its combinations, then colour (grid, then the merged brand+price tab)
// — each table gets its own tab rather than being grouped under a
// cluster. Brands and prices share one tab, "Painting prices", grouped
// by brand within it, rather than two separate tabs.
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

// Versions are per-entity now (Section 4), not one global counter, so
// the badge shows whichever entity(ies) the visible tab actually writes
// to — most tabs write to one entity, but the merged "Painting prices"
// tab writes to both PaintBrand and PaintingPrice, so it shows two.
const TAB_ENTITIES: Record<Tab, LookupEntity[]> = {
  systemBrands: [LookupEntity.SYSTEM_BRAND],
  systemCatalogs: [LookupEntity.SYSTEM_CATALOG],
  systemProfiles: [LookupEntity.SYSTEM_PROFILE],
  glass: [LookupEntity.GLASS],
  glassCombinations: [LookupEntity.GLASS_COMBINATION],
  colors: [LookupEntity.COLOR],
  paintingPrices: [LookupEntity.PAINT_BRAND, LookupEntity.PAINTING_PRICE],
}

export function DataWarehousePage() {
  const { t } = useTranslation('admin')
  const [tab, setTab] = useState<Tab>('systemBrands')
  const { data: versions } = useLookupVersionQuery()

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">{t('dataWarehousePage.title')}</h1>
        <div className="flex items-center gap-2">
          {TAB_ENTITIES[tab].map((entity) => (
            <Badge key={entity} variant="outline">
              {t('dataWarehousePage.version', { version: versions?.[entity] ?? '—' })}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((tabId) => (
          <Button
            key={tabId}
            variant={tab === tabId ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab(tabId)}
          >
            {t(`dataWarehousePage.tables.${tabId}`)}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'systemBrands' && <SystemBrandsTab />}
        {tab === 'systemCatalogs' && <SystemCatalogsTab />}
        {tab === 'systemProfiles' && <SystemProfilesTab />}
        {tab === 'glass' && <GlassTab />}
        {tab === 'glassCombinations' && <GlassCombinationSection />}
        {tab === 'colors' && <ColorGridSection />}
        {tab === 'paintingPrices' && <PaintingPricesSection />}
      </div>
    </div>
  )
}

function GlassTab() {
  const { t } = useTranslation('admin')
  const copy = t('dataWarehousePage.bulk.copySuffix')

  return (
    <SimpleLookupSection
      title={t('dataWarehousePage.tables.glass')}
      createLabel={t('dataWarehousePage.createButtons.glass')}
      emptyLabel={t('dataWarehousePage.empty.glass')}
      errorLabel={t('dataWarehousePage.messages.error')}
      createSchema={createGlassSchema}
      updateSchema={updateGlassSchema}
      createDefaults={{ name: '', thickness: 4, weightPerSqm: 10, pricePerSqm: 0 } as CreateGlassInput}
      fields={[
        { name: 'name', label: t('dataWarehousePage.fields.name'), type: 'text' },
        { name: 'thickness', label: t('dataWarehousePage.fields.thickness'), type: 'number', min: 1 },
        { name: 'weightPerSqm', label: t('dataWarehousePage.fields.weightPerSqm'), type: 'number', step: 0.01, min: 0 },
        { name: 'pricePerSqm', label: t('dataWarehousePage.fields.pricePerSqm'), type: 'number', step: 0.01, min: 0 },
      ]}
      columns={[
        { header: t('dataWarehousePage.fields.name'), cell: (row) => row.name },
        { header: t('dataWarehousePage.fields.thickness'), cell: (row) => row.thickness },
        { header: t('dataWarehousePage.fields.weightPerSqm'), cell: (row) => row.weightPerSqm.toFixed(2) },
        { header: t('dataWarehousePage.fields.pricePerSqm'), cell: (row) => row.pricePerSqm.toFixed(2) },
      ]}
      search={{
        placeholder: t('dataWarehousePage.search.glass'),
        match: (row, query) => row.name.toLowerCase().includes(query.toLowerCase()),
      }}
      useList={useGlassQuery}
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
      deleteWarning={t('dataWarehousePage.deleteWarnings.glass')}
    />
  )
}

function SystemBrandsTab() {
  const { t } = useTranslation('admin')
  const copy = t('dataWarehousePage.bulk.copySuffix')

  return (
    <SimpleLookupSection
      title={t('dataWarehousePage.tables.systemBrands')}
      createLabel={t('dataWarehousePage.createButtons.systemBrand')}
      emptyLabel={t('dataWarehousePage.empty.systemBrand')}
      errorLabel={t('dataWarehousePage.messages.error')}
      createSchema={createSystemBrandSchema}
      updateSchema={updateSystemBrandSchema}
      createDefaults={{ name: '' } as CreateSystemBrandInput}
      fields={[{ name: 'name', label: t('dataWarehousePage.fields.name'), type: 'text' }]}
      columns={[{ header: t('dataWarehousePage.fields.name'), cell: (row) => row.name }]}
      search={{
        placeholder: t('dataWarehousePage.search.systemBrands'),
        match: (row, query) => row.name.toLowerCase().includes(query.toLowerCase()),
      }}
      useList={useSystemBrandsQuery}
      useCreate={useCreateSystemBrandMutation}
      useUpdate={useUpdateSystemBrandMutation}
      useDelete={useDeleteSystemBrandMutation}
      bulkDelete={lookupsApi.bulkDeleteSystemBrands}
      bulkDuplicate={lookupsApi.bulkDuplicateSystemBrands}
      duplicate={(row) => ({ name: `${row.name} ${copy}` })}
      toEditDefaults={(row) => ({ name: row.name })}
      rowLabel={(row) => row.name}
      deleteWarning={t('dataWarehousePage.deleteWarnings.systemBrand')}
      headerExtra={<SystemsImportButton />}
    />
  )
}

function SystemCatalogsTab() {
  const { t } = useTranslation('admin')
  const copy = t('dataWarehousePage.bulk.copySuffix')
  const { data: brands } = useSystemBrandsQuery()
  const brandOptions = (brands ?? []).map((b) => ({ value: b.id, label: b.name }))
  const systemTypeOptions = Object.values(SystemType).map((v) => ({
    value: v,
    label: t(`dataWarehousePage.systemType.${v}`),
  }))

  return (
    <SimpleLookupSection
      title={t('dataWarehousePage.tables.systemCatalogs')}
      createLabel={t('dataWarehousePage.createButtons.systemCatalog')}
      emptyLabel={t('dataWarehousePage.empty.systemCatalog')}
      errorLabel={t('dataWarehousePage.messages.error')}
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
        { name: 'brandId', label: t('dataWarehousePage.fields.brand'), type: 'select', options: brandOptions },
        { name: 'name', label: t('dataWarehousePage.fields.name'), type: 'text' },
        {
          name: 'systemType',
          label: t('dataWarehousePage.fields.systemType'),
          type: 'select',
          options: systemTypeOptions,
        },
        { name: 'maxGlassThickness', label: t('dataWarehousePage.fields.maxGlassThickness'), type: 'number', min: 1 },
        { name: 'maxSashWeight', label: t('dataWarehousePage.fields.maxSashWeight'), type: 'number', min: 1 },
      ]}
      columns={[
        { header: t('dataWarehousePage.fields.brand'), cell: (row) => row.brandName },
        { header: t('dataWarehousePage.fields.name'), cell: (row) => row.name },
        {
          header: t('dataWarehousePage.fields.systemType'),
          cell: (row) => t(`dataWarehousePage.systemType.${row.systemType}`),
        },
        { header: t('dataWarehousePage.fields.maxGlassThickness'), cell: (row) => row.maxGlassThickness },
        { header: t('dataWarehousePage.fields.maxSashWeight'), cell: (row) => row.maxSashWeight },
      ]}
      search={{
        placeholder: t('dataWarehousePage.search.systemCatalogs'),
        match: (row, query) => {
          const q = query.toLowerCase()
          return row.name.toLowerCase().includes(q) || row.brandName.toLowerCase().includes(q)
        },
      }}
      filters={[
        {
          key: 'brand',
          allLabel: t('dataWarehousePage.filters.allBrands'),
          options: brandOptions,
          match: (row, value) => row.brandId === value,
        },
        {
          key: 'systemType',
          allLabel: t('dataWarehousePage.filters.allTypes'),
          options: systemTypeOptions,
          match: (row, value) => row.systemType === value,
        },
      ]}
      useList={useSystemCatalogsQuery}
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
      deleteWarning={t('dataWarehousePage.deleteWarnings.systemCatalog')}
      headerExtra={<SystemsImportButton />}
    />
  )
}

function SystemProfilesTab() {
  const { t } = useTranslation('admin')
  const { data: catalogs } = useSystemCatalogsQuery()
  const catalogOptions = (catalogs ?? []).map((c) => ({ value: c.id, label: `${c.brandName} · ${c.name}` }))
  const profileTypeOptions = Object.values(ProfileType).map((v) => ({
    value: v,
    label: t(`dataWarehousePage.profileType.${v}`),
  }))

  return (
    <SimpleLookupSection
      title={t('dataWarehousePage.tables.systemProfiles')}
      createLabel={t('dataWarehousePage.createButtons.systemProfile')}
      emptyLabel={t('dataWarehousePage.empty.systemProfile')}
      errorLabel={t('dataWarehousePage.messages.error')}
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
        { name: 'catalogId', label: t('dataWarehousePage.fields.catalog'), type: 'select', options: catalogOptions },
        { name: 'profileNo', label: t('dataWarehousePage.fields.profileNo'), type: 'text' },
        {
          name: 'profileType',
          label: t('dataWarehousePage.fields.profileType'),
          type: 'select',
          options: profileTypeOptions,
        },
        { name: 'maxGlassThickness', label: t('dataWarehousePage.fields.maxGlassThickness'), type: 'number', min: 1 },
        { name: 'weight', label: t('dataWarehousePage.fields.weight'), type: 'number', step: 0.01, min: 0 },
        { name: 'perimeter', label: t('dataWarehousePage.fields.perimeter'), type: 'number', min: 1 },
        { name: 'inertiaIx', label: t('dataWarehousePage.fields.inertiaIx'), type: 'number', step: 0.01, min: 0 },
        { name: 'inertiaIy', label: t('dataWarehousePage.fields.inertiaIy'), type: 'number', step: 0.01, min: 0 },
      ]}
      columns={[
        { header: t('dataWarehousePage.fields.catalog'), cell: (row) => row.catalogName },
        { header: t('dataWarehousePage.fields.profileNo'), cell: (row) => row.profileNo },
        {
          header: t('dataWarehousePage.fields.profileType'),
          cell: (row) => t(`dataWarehousePage.profileType.${row.profileType}`),
        },
        { header: t('dataWarehousePage.fields.maxGlassThickness'), cell: (row) => row.maxGlassThickness },
        { header: t('dataWarehousePage.fields.weight'), cell: (row) => row.weight.toFixed(2) },
        { header: t('dataWarehousePage.fields.perimeter'), cell: (row) => row.perimeter },
        { header: t('dataWarehousePage.fields.inertiaIx'), cell: (row) => row.inertiaIx.toFixed(2) },
        { header: t('dataWarehousePage.fields.inertiaIy'), cell: (row) => row.inertiaIy.toFixed(2) },
      ]}
      search={{
        placeholder: t('dataWarehousePage.search.systemProfiles'),
        match: (row, query) => {
          const q = query.toLowerCase()
          return row.profileNo.toLowerCase().includes(q) || row.catalogName.toLowerCase().includes(q)
        },
      }}
      filters={[
        {
          key: 'catalog',
          allLabel: t('dataWarehousePage.filters.allCatalogs'),
          options: catalogOptions,
          match: (row, value) => row.catalogId === value,
        },
        {
          key: 'profileType',
          allLabel: t('dataWarehousePage.filters.allTypes'),
          options: profileTypeOptions,
          match: (row, value) => row.profileType === value,
        },
      ]}
      useList={useSystemProfilesQuery}
      useCreate={useCreateSystemProfileMutation}
      useUpdate={useUpdateSystemProfileMutation}
      useDelete={useDeleteSystemProfileMutation}
      bulkDelete={lookupsApi.bulkDeleteSystemProfiles}
      bulkDuplicate={lookupsApi.bulkDuplicateSystemProfiles}
      duplicate={(row) => ({
        // profileNo is unique per catalogue, unlike the other entities'
        // duplicated names — a plain " copy" suffix on top of another
        // suffix would compound on repeated duplicates, so this uses a
        // hyphenated form matching how profile numbers are normally
        // varied (P-100, P-100-copy).
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
      headerExtra={<SystemsImportButton />}
    />
  )
}
