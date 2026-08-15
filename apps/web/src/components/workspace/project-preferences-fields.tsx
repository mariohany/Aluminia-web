import { useTranslation } from 'react-i18next'
import type { UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { CreateProjectInput } from '@repo/types/projects'
import { PROJECT_CURRENCIES } from '@repo/types/projects'
import { formatScopedRef } from '@repo/types/company-lookups'
import { useMergedSystemBrandsQuery, useMergedSystemCatalogsQuery } from '@/lib/lookup-merge'
import { FieldLabel } from '@/components/workspace/field-label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Blank -> null (a deliberate clear), otherwise a parsed number. Same
// rule as form-fields.ts's optionalTextField, applied by hand here
// rather than through register()'s setValueAs — see the rate inputs
// below for why.
function parsePercent(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

// Radix's Select rejects an empty-string item value, so "no selection"
// needs a sentinel — same pattern lookup-table-section.tsx's scope
// filter already uses (`__all`).
const NONE = '__none'

/**
 * Step 2 of ProjectDialog — every field optional, every one a default
 * the window designer will inherit later, never a constraint
 * (docs/project_preferences_planing.md). Brand and catalogue are
 * scope-aware: they read the same merged platform+company catalogue
 * the workspace Data page uses, tag each option with the same Origin
 * badge, and store a ScopedRef string.
 */
export function ProjectPreferencesFields({
  watch,
  setValue,
}: {
  watch: UseFormWatch<CreateProjectInput>
  setValue: UseFormSetValue<CreateProjectInput>
}) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')

  const brands = useMergedSystemBrandsQuery()
  const catalogs = useMergedSystemCatalogsQuery()

  const brandRef = watch('defaultSystemBrand')
  const catalogRef = watch('defaultSystemCatalog')
  const currency = watch('currency')
  const vatRate = watch('vatRate')
  const discountRate = watch('discountRate')

  // Catalogue options are filtered to the selected brand — a catalogue
  // is meaningless without knowing which brand it belongs to, and the
  // list would otherwise mix every brand's catalogues together.
  const catalogOptions = brandRef
    ? (catalogs.data?.filter((catalog) => catalog.brand === brandRef) ?? [])
    : []

  return (
    <div className="flex flex-col gap-3">
      <div>
        <FieldLabel htmlFor="project-system-brand" optional>
          {t('fields.defaultSystemBrand')}
        </FieldLabel>
        <Select
          value={brandRef ?? NONE}
          onValueChange={(value) => {
            const next = value === NONE ? null : value
            setValue('defaultSystemBrand', next, { shouldValidate: true })
            // Changing the brand always clears the catalogue — a
            // catalogue under the old brand no longer applies, and the
            // API enforces this same rule on a direct PATCH.
            setValue('defaultSystemCatalog', null, { shouldValidate: true })
          }}
        >
          <SelectTrigger id="project-system-brand" className="mt-1.5 w-full">
            <SelectValue placeholder={t('fields.defaultSystemBrandPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('fields.defaultSystemBrandPlaceholder')}</SelectItem>
            {brands.data?.map((brand) => (
              <SelectItem key={brand.id} value={formatScopedRef(brand.scope, brand.id)}>
                {brand.name}
                <span className="ms-1.5 text-xs text-muted-foreground">
                  {brand.scope === 'company' ? tLookups('scope.ours') : tLookups('scope.platform')}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <FieldLabel htmlFor="project-system-catalog" optional>
          {t('fields.defaultSystemCatalog')}
        </FieldLabel>
        <Select
          value={catalogRef ?? NONE}
          disabled={!brandRef}
          onValueChange={(value) =>
            setValue('defaultSystemCatalog', value === NONE ? null : value, { shouldValidate: true })
          }
        >
          <SelectTrigger id="project-system-catalog" className="mt-1.5 w-full">
            <SelectValue
              placeholder={
                brandRef ? t('fields.defaultSystemCatalogPlaceholder') : t('fields.defaultSystemCatalogNeedsBrand')
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('fields.defaultSystemCatalogPlaceholder')}</SelectItem>
            {catalogOptions.map((catalog) => (
              <SelectItem key={catalog.id} value={formatScopedRef(catalog.scope, catalog.id)}>
                {catalog.name}
                <span className="ms-1.5 text-xs text-muted-foreground">
                  {catalog.scope === 'company' ? tLookups('scope.ours') : tLookups('scope.platform')}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="project-currency" optional>
            {t('fields.currency')}
          </FieldLabel>
          <Select
            value={currency ?? NONE}
            onValueChange={(value) =>
              setValue('currency', value === NONE ? null : (value as (typeof PROJECT_CURRENCIES)[number]), {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger id="project-currency" className="mt-1.5 w-full">
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
        <div>
          <FieldLabel htmlFor="project-vat-rate" optional>
            {t('fields.vatRate')}
          </FieldLabel>
          <Input
            id="project-vat-rate"
            className="mt-1.5"
            type="number"
            min={0}
            max={100}
            step="any"
            dir="ltr"
            value={vatRate ?? ''}
            onChange={(e) => setValue('vatRate', parsePercent(e.target.value), { shouldValidate: true })}
          />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="project-discount-rate" optional>
          {t('fields.discountRate')}
        </FieldLabel>
        <Input
          id="project-discount-rate"
          className="mt-1.5"
          type="number"
          min={0}
          max={100}
          step="any"
          dir="ltr"
          value={discountRate ?? ''}
          onChange={(e) => setValue('discountRate', parsePercent(e.target.value), { shouldValidate: true })}
        />
      </div>
    </div>
  )
}
