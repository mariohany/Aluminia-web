import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LookupEntity,
  ProfileType,
  SystemType,
  type CreateColorBrandInput,
  type CreateColorPriceInput,
  type CreateGlassInput,
  type CreateSystemBrandInput,
  type CreateSystemCatalogInput,
  type CreateSystemProfileInput,
} from '@repo/types/lookups'
import {
  createColorBrandSchema,
  createColorPriceSchema,
  createGlassSchema,
  createSystemBrandSchema,
  createSystemCatalogSchema,
  createSystemProfileSchema,
  updateColorBrandSchema,
  updateColorPriceSchema,
  updateGlassSchema,
  updateSystemBrandSchema,
  updateSystemCatalogSchema,
  updateSystemProfileSchema,
} from '@repo/types/lookups'
import * as lookupsApi from '@/lib/lookups-api'
import {
  useColorBrandsQuery,
  useColorPricesQuery,
  useCreateColorBrandMutation,
  useCreateColorPriceMutation,
  useCreateGlassMutation,
  useCreateSystemBrandMutation,
  useCreateSystemCatalogMutation,
  useCreateSystemProfileMutation,
  useDeleteColorBrandMutation,
  useDeleteColorPriceMutation,
  useDeleteGlassMutation,
  useDeleteSystemBrandMutation,
  useDeleteSystemCatalogMutation,
  useDeleteSystemProfileMutation,
  useGlassQuery,
  useLookupVersionQuery,
  useSystemBrandsQuery,
  useSystemCatalogsQuery,
  useSystemProfilesQuery,
  useUpdateColorBrandMutation,
  useUpdateColorPriceMutation,
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

// Order requested: systems (brand → catalog → profile), then glass and
// its combinations, then colour (grid, brand, price) — each table gets
// its own tab rather than being grouped under a cluster.
const TABS = [
  'systemBrands',
  'systemCatalogs',
  'systemProfiles',
  'glass',
  'glassCombinations',
  'colors',
  'colorBrands',
  'colorPrices',
] as const
type Tab = (typeof TABS)[number]

// Versions are per-entity now (Section 4), not one global counter, so
// the badge shows whichever entity the visible tab actually writes to.
const TAB_ENTITY: Record<Tab, LookupEntity> = {
  systemBrands: LookupEntity.SYSTEM_BRAND,
  systemCatalogs: LookupEntity.SYSTEM_CATALOG,
  systemProfiles: LookupEntity.SYSTEM_PROFILE,
  glass: LookupEntity.GLASS,
  glassCombinations: LookupEntity.GLASS_COMBINATION,
  colors: LookupEntity.COLOR,
  colorBrands: LookupEntity.COLOR_BRAND,
  colorPrices: LookupEntity.COLOR_PRICE,
}

export function DataWarehousePage() {
  const { t } = useTranslation('admin')
  const [tab, setTab] = useState<Tab>('systemBrands')
  const { data: versions } = useLookupVersionQuery()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">{t('dataWarehousePage.title')}</h1>
        <Badge variant="outline">
          {t('dataWarehousePage.version', { version: versions?.[TAB_ENTITY[tab]] ?? '—' })}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
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

      {tab === 'systemBrands' && <SystemBrandsTab />}
      {tab === 'systemCatalogs' && <SystemCatalogsTab />}
      {tab === 'systemProfiles' && <SystemProfilesTab />}
      {tab === 'glass' && <GlassTab />}
      {tab === 'glassCombinations' && <GlassCombinationSection />}
      {tab === 'colors' && <ColorGridSection />}
      {tab === 'colorBrands' && <ColorBrandsTab />}
      {tab === 'colorPrices' && <ColorPricesTab />}
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
        { header: t('dataWarehousePage.fields.thickness'), cell: (row) => `${row.thickness} mm` },
        { header: t('dataWarehousePage.fields.pricePerSqm'), cell: (row) => row.pricePerSqm },
      ]}
      useList={useGlassQuery}
      useCreate={useCreateGlassMutation}
      useUpdate={useUpdateGlassMutation}
      useDelete={useDeleteGlassMutation}
      createOne={lookupsApi.createGlass}
      deleteOne={lookupsApi.deleteGlass}
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

function ColorBrandsTab() {
  const { t } = useTranslation('admin')
  const copy = t('dataWarehousePage.bulk.copySuffix')

  return (
    <SimpleLookupSection
      title={t('dataWarehousePage.tables.colorBrands')}
      createLabel={t('dataWarehousePage.createButtons.colorBrand')}
      emptyLabel={t('dataWarehousePage.empty.colorBrand')}
      errorLabel={t('dataWarehousePage.messages.error')}
      createSchema={createColorBrandSchema}
      updateSchema={updateColorBrandSchema}
      createDefaults={{ name: '' } as CreateColorBrandInput}
      fields={[{ name: 'name', label: t('dataWarehousePage.fields.name'), type: 'text' }]}
      columns={[{ header: t('dataWarehousePage.fields.name'), cell: (row) => row.name }]}
      useList={useColorBrandsQuery}
      useCreate={useCreateColorBrandMutation}
      useUpdate={useUpdateColorBrandMutation}
      useDelete={useDeleteColorBrandMutation}
      createOne={lookupsApi.createColorBrand}
      deleteOne={lookupsApi.deleteColorBrand}
      duplicate={(row) => ({ name: `${row.name} ${copy}` })}
      toEditDefaults={(row) => ({ name: row.name })}
      rowLabel={(row) => row.name}
      deleteWarning={t('dataWarehousePage.deleteWarnings.colorBrand')}
    />
  )
}

function ColorPricesTab() {
  const { t } = useTranslation('admin')
  const copy = t('dataWarehousePage.bulk.copySuffix')
  const { data: brands } = useColorBrandsQuery()
  const brandOptions = (brands ?? []).map((b) => ({ value: b.id, label: b.name }))

  return (
    <SimpleLookupSection
      title={t('dataWarehousePage.tables.colorPrices')}
      createLabel={t('dataWarehousePage.createButtons.colorPrice')}
      emptyLabel={t('dataWarehousePage.empty.colorPrice')}
      errorLabel={t('dataWarehousePage.messages.error')}
      createSchema={createColorPriceSchema}
      updateSchema={updateColorPriceSchema}
      createDefaults={{ brandId: '', type: '', price: 0 } as CreateColorPriceInput}
      fields={[
        { name: 'brandId', label: t('dataWarehousePage.fields.brand'), type: 'select', options: brandOptions },
        { name: 'type', label: t('dataWarehousePage.fields.type'), type: 'text' },
        { name: 'price', label: t('dataWarehousePage.fields.price'), type: 'number', step: 0.01, min: 0 },
      ]}
      columns={[
        { header: t('dataWarehousePage.fields.brand'), cell: (row) => row.brandName },
        { header: t('dataWarehousePage.fields.type'), cell: (row) => row.type },
        { header: t('dataWarehousePage.fields.price'), cell: (row) => row.price },
      ]}
      useList={useColorPricesQuery}
      useCreate={useCreateColorPriceMutation}
      useUpdate={useUpdateColorPriceMutation}
      useDelete={useDeleteColorPriceMutation}
      createOne={lookupsApi.createColorPrice}
      deleteOne={lookupsApi.deleteColorPrice}
      duplicate={(row) => ({ brandId: row.brandId, type: `${row.type} ${copy}`, price: row.price })}
      toEditDefaults={(row) => ({ brandId: row.brandId, type: row.type, price: row.price })}
      rowLabel={(row) => `${row.brandName} · ${row.type}`}
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
      useList={useSystemBrandsQuery}
      useCreate={useCreateSystemBrandMutation}
      useUpdate={useUpdateSystemBrandMutation}
      useDelete={useDeleteSystemBrandMutation}
      createOne={lookupsApi.createSystemBrand}
      deleteOne={lookupsApi.deleteSystemBrand}
      duplicate={(row) => ({ name: `${row.name} ${copy}` })}
      toEditDefaults={(row) => ({ name: row.name })}
      rowLabel={(row) => row.name}
      deleteWarning={t('dataWarehousePage.deleteWarnings.systemBrand')}
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
      ]}
      useList={useSystemCatalogsQuery}
      useCreate={useCreateSystemCatalogMutation}
      useUpdate={useUpdateSystemCatalogMutation}
      useDelete={useDeleteSystemCatalogMutation}
      createOne={lookupsApi.createSystemCatalog}
      deleteOne={lookupsApi.deleteSystemCatalog}
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
      ]}
      useList={useSystemProfilesQuery}
      useCreate={useCreateSystemProfileMutation}
      useUpdate={useUpdateSystemProfileMutation}
      useDelete={useDeleteSystemProfileMutation}
      createOne={lookupsApi.createSystemProfile}
      deleteOne={lookupsApi.deleteSystemProfile}
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
    />
  )
}
