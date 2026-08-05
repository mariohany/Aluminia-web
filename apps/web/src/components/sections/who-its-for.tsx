import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/section'

export function WhoItsFor() {
  const { t } = useTranslation('whoItsFor')

  return (
    <Section className="bg-secondary/30">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('body')}</p>
        <p className="mt-4 text-sm text-muted-foreground">{t('notFor')}</p>
      </div>
    </Section>
  )
}
