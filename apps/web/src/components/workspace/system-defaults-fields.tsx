import { useTranslation } from 'react-i18next'
import { PROJECT_CURRENCIES, type ProjectCurrency } from '@repo/types/projects'
import { formatScopedRef } from '@repo/types/company-lookups'
import { useMergedSystemBrandsQuery, useMergedSystemCatalogsQuery } from '@/lib/lookup-merge'
import { FieldLabel } from '@/components/workspace/field-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Radix's Select rejects an empty-string item value, so "no selection"
// needs a sentinel — same pattern lookup-table-section.tsx's scope
// filter already uses (`__all`).
const NONE = '__none'

/**
 * Brand → catalogue pickers, shared by a project's preferences
 * (`ProjectPreferencesFields`) and Config › Project settings' new-project
 * defaults. Scope-aware: they read the same merged platform + company
 * catalogue the workspace Data page uses, tag each option with its Origin,
 * and hand back ScopedRef strings. Changing the brand always clears the
 * catalogue: a catalogue under the old brand no longer applies, and the
 * projects API enforces the same rule on a direct PATCH.
 */
export function SystemBrandCatalogFields({
  idPrefix,
  brand,
  catalog,
  onChange,
}: {
  idPrefix: string
  brand: string | null | undefined
  catalog: string | null | undefined
  onChange: (next: { brand: string | null; catalog: string | null }) => void
}) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')
  const brands = useMergedSystemBrandsQuery()
  const catalogs = useMergedSystemCatalogsQuery()

  // Catalogue options are filtered to the selected brand — a catalogue
  // is meaningless without knowing which brand it belongs to, and the
  // list would otherwise mix every brand's catalogues together.
  const catalogOptions = brand ? (catalogs.data?.filter((option) => option.brand === brand) ?? []) : []

  return (
    <>
      <div>
        <FieldLabel htmlFor={`${idPrefix}-system-brand`} optional>
          {t('fields.defaultSystemBrand')}
        </FieldLabel>
        <Select
          value={brand ?? NONE}
          onValueChange={(value) => onChange({ brand: value === NONE ? null : value, catalog: null })}
        >
          <SelectTrigger id={`${idPrefix}-system-brand`} className="mt-1.5 w-full">
            <SelectValue placeholder={t('fields.defaultSystemBrandPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('fields.defaultSystemBrandPlaceholder')}</SelectItem>
            {brands.data?.map((option) => (
              <SelectItem key={option.id} value={formatScopedRef(option.scope, option.id)}>
                {option.name}
                <span className="ms-1.5 text-xs text-muted-foreground">
                  {option.scope === 'company' ? tLookups('scope.ours') : tLookups('scope.platform')}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <FieldLabel htmlFor={`${idPrefix}-system-catalog`} optional>
          {t('fields.defaultSystemCatalog')}
        </FieldLabel>
        <Select
          value={catalog ?? NONE}
          disabled={!brand}
          onValueChange={(value) => onChange({ brand: brand ?? null, catalog: value === NONE ? null : value })}
        >
          <SelectTrigger id={`${idPrefix}-system-catalog`} className="mt-1.5 w-full">
            <SelectValue
              placeholder={
                brand ? t('fields.defaultSystemCatalogPlaceholder') : t('fields.defaultSystemCatalogNeedsBrand')
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('fields.defaultSystemCatalogPlaceholder')}</SelectItem>
            {catalogOptions.map((option) => (
              <SelectItem key={option.id} value={formatScopedRef(option.scope, option.id)}>
                {option.name}
                <span className="ms-1.5 text-xs text-muted-foreground">
                  {option.scope === 'company' ? tLookups('scope.ours') : tLookups('scope.platform')}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

export function CurrencySelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: ProjectCurrency | null | undefined
  onChange: (next: ProjectCurrency | null) => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <div>
      <FieldLabel htmlFor={id} optional>
        {t('fields.currency')}
      </FieldLabel>
      <Select
        value={value ?? NONE}
        onValueChange={(next) => onChange(next === NONE ? null : (next as ProjectCurrency))}
      >
        <SelectTrigger id={id} className="mt-1.5 w-full">
          <SelectValue placeholder={t('fields.currencyPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('fields.currencyPlaceholder')}</SelectItem>
          {PROJECT_CURRENCIES.map((code) => (
            <SelectItem key={code} value={code}>
              {code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
