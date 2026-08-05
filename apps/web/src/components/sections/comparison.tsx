import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import { Section } from '@/components/layout/section'

const rowKeys = ['knowsProfiles', 'pricesFromDesign', 'cuttingList', 'oneSource', 'isolatedData'] as const

export function Comparison() {
  const { t } = useTranslation('comparison')

  return (
    <Section>
      <div className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('subhead')}</p>
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-start">
          <thead>
            <tr className="border-b border-border">
              <th className="py-3 pe-4 text-start text-sm font-medium text-muted-foreground" />
              <th className="w-40 px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                {t('columns.generic')}
              </th>
              <th className="w-40 px-4 py-3 text-center text-sm font-semibold text-foreground">
                {t('columns.aluminia')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rowKeys.map((key) => (
              <tr key={key} className="border-b border-border">
                <td className="py-4 pe-4 text-sm text-foreground">{t(`rows.${key}`)}</td>
                <td className="px-4 py-4 text-center">
                  <X className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
                </td>
                <td className="px-4 py-4 text-center">
                  <Check className="mx-auto size-5 text-primary" aria-hidden="true" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
