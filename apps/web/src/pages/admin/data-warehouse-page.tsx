import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LookupEntity,
  ProfileType,
  SystemType,
  DEFAULT_SLIDING_RAILS,
  isSlidingFrameProfile,
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
  useColorsQuery,
  useGlassCombinationsQuery,
  useGlassQuery,
  usePaintingPricesQuery,
  useLookupVersionQuery,
  useSystemBrandsQuery,
  useSystemCatalogsQuery,
  useSystemProfilesQuery,
  useUpdateGlassMutation,
  useUpdateSystemBrandMutation,
  useUpdateSystemCatalogMutation,
  useUpdateSystemProfileMutation,
} from '@/lib/lookups-queries'
import { SLIDING_MAX_RAILS, SLIDING_MIN_RAILS } from '@repo/types/sliding'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { LookupTableSection } from '@/components/lookups/lookup-table-section'
import { ProfileTypePill } from '@/components/lookups/profile-type-pill'
import { GlassCombinationSection } from '@/components/lookups/glass-combination-editor'
import { ColorGridSection } from '@/components/lookups/color-grid-section'
import { SystemsImportButton } from '@/components/admin/lookups/systems-import-button'
import { PaintingPricesSection } from '@/components/lookups/painting-prices-section'

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

/** Row count per tab, from the same list queries the tabs read (cached). */
function useTabCounts(): Record<Tab, number | undefined> {
  const { data: systemBrands } = useSystemBrandsQuery()
  const { data: systemCatalogs } = useSystemCatalogsQuery()
  const { data: systemProfiles } = useSystemProfilesQuery()
  const { data: glass } = useGlassQuery()
  const { data: glassCombinations } = useGlassCombinationsQuery()
  const { data: colors } = useColorsQuery()
  const { data: paintingPrices } = usePaintingPricesQuery()
  return {
    systemBrands: systemBrands?.length,
    systemCatalogs: systemCatalogs?.length,
    systemProfiles: systemProfiles?.length,
    glass: glass?.length,
    glassCombinations: glassCombinations?.length,
    colors: colors?.length,
    paintingPrices: paintingPrices?.length,
  }
}

/**
 * The shared catalogue (docs/admin_redesign_planing.md §6, option A):
 * one underline tab per table with its row count, the open table in a
 * card. The table sections themselves are shared with the company's own
 * Data page and stay as they are.
 */
export function DataWarehousePage() {
  const { t, i18n } = useTranslation('lookups')
  const [tab, setTab] = useState<Tab>('systemBrands')
  const { data: versions } = useLookupVersionQuery()
  const counts = useTabCounts()
  const numberFormatter = new Intl.NumberFormat(i18n.language)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {TAB_ENTITIES[tab].map((entity) => (
            <Badge key={entity} variant="outline">
              {t('version', { version: versions?.[entity] ?? '—' })}
            </Badge>
          ))}
        </div>
      </div>

      <div role="tablist" aria-label={t('tablesLabel')} className="flex shrink-0 gap-5 overflow-x-auto border-b border-border">
        {TABS.map((tabId) => {
          const on = tab === tabId
          const count = counts[tabId]
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(tabId)}
              className={cn(
                '-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 px-0.5 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                on ? 'border-primary font-semibold text-foreground' : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`tables.${tabId}`)}
              {count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 font-mono text-[11px] font-normal',
                    on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {numberFormatter.format(count)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" className="min-h-0 flex-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
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
      useList={useSystemBrandsQuery}
      useCreate={useCreateSystemBrandMutation}
      useUpdate={useUpdateSystemBrandMutation}
      useDelete={useDeleteSystemBrandMutation}
      bulkDelete={lookupsApi.bulkDeleteSystemBrands}
      bulkDuplicate={lookupsApi.bulkDuplicateSystemBrands}
      duplicate={(row) => ({ name: `${row.name} ${copy}` })}
      toEditDefaults={(row) => ({ name: row.name })}
      rowLabel={(row) => row.name}
      deleteWarning={t('deleteWarnings.systemBrand')}
      headerExtra={<SystemsImportButton />}
    />
  )
}

function SystemCatalogsTab() {
  const { t } = useTranslation('lookups')
  const copy = t('bulk.copySuffix')
  const { data: brands } = useSystemBrandsQuery()
  const brandOptions = (brands ?? []).map((b) => ({ value: b.id, label: b.name }))
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
      deleteWarning={t('deleteWarnings.systemCatalog')}
      headerExtra={<SystemsImportButton />}
    />
  )
}

function SystemProfilesTab() {
  const { t } = useTranslation('lookups')
  const { data: catalogs } = useSystemCatalogsQuery()
  const catalogOptions = (catalogs ?? []).map((c) => ({ value: c.id, label: `${c.brandName} · ${c.name}` }))
  const catalogById = new Map((catalogs ?? []).map((c) => [c.id, c]))
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
          acceptsFlyScreen: false,
          slidingRails: 2,
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
        { name: 'acceptsFlyScreen', label: t('fields.acceptsFlyScreen'), type: 'boolean' },
        // Only a FRAME in a SLIDING catalogue has rails (planing §11);
        // for anything else the API stores null whatever this holds.
        {
          name: 'slidingRails',
          label: t('fields.slidingRails'),
          type: 'number',
          min: SLIDING_MIN_RAILS,
          max: SLIDING_MAX_RAILS,
          shownDefault: DEFAULT_SLIDING_RAILS,
          visibleWhen: (v) => isSlidingFrameProfile(v.profileType ?? ProfileType.FRAME, catalogById.get(v.catalogId ?? '')?.systemType),
        },
      ]}
      columns={[
        { header: t('fields.catalog'), cell: (row) => row.catalogName },
        { header: t('fields.profileNo'), cell: (row) => row.profileNo },
        {
          header: t('fields.profileType'),
          cell: (row) => <ProfileTypePill type={row.profileType} />,
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
        { header: t('fields.slidingRails'), cell: (row) => row.slidingRails ?? '—' },
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
        acceptsFlyScreen: row.acceptsFlyScreen,
        slidingRails: row.slidingRails,
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
        acceptsFlyScreen: row.acceptsFlyScreen,
        slidingRails: row.slidingRails,
      })}
      rowLabel={(row) => row.profileNo}
      headerExtra={<SystemsImportButton />}
    />
  )
}
