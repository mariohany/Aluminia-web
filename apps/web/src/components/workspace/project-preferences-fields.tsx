import { useTranslation } from 'react-i18next'
import type { UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { CreateProjectInput } from '@repo/types/projects'
import { FieldLabel } from '@/components/workspace/field-label'
import { CurrencySelect, SystemBrandCatalogFields } from '@/components/workspace/system-defaults-fields'
import { Input } from '@/components/ui/input'

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

/**
 * Step 2 of ProjectDialog — every field optional, every one a default
 * the window designer will inherit later, never a constraint
 * (docs/project_preferences_planing.md). Brand / catalogue and currency
 * are the shared `system-defaults-fields` (Config › Project settings uses
 * them too).
 */
export function ProjectPreferencesFields({
  watch,
  setValue,
}: {
  watch: UseFormWatch<CreateProjectInput>
  setValue: UseFormSetValue<CreateProjectInput>
}) {
  const { t } = useTranslation('workspace')

  const brandRef = watch('defaultSystemBrand')
  const catalogRef = watch('defaultSystemCatalog')
  const currency = watch('currency')
  const vatRate = watch('vatRate')
  const discountRate = watch('discountRate')

  return (
    <div className="flex flex-col gap-3">
      <SystemBrandCatalogFields
        idPrefix="project"
        brand={brandRef}
        catalog={catalogRef}
        onChange={(next) => {
          setValue('defaultSystemBrand', next.brand, { shouldValidate: true })
          setValue('defaultSystemCatalog', next.catalog, { shouldValidate: true })
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <CurrencySelect
          id="project-currency"
          value={currency}
          onChange={(next) => setValue('currency', next, { shouldValidate: true })}
        />
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
