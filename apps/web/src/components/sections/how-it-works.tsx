import { useTranslation } from 'react-i18next'
import { ClipboardList, FileText, PenTool } from 'lucide-react'
import { Section } from '@/components/layout/section'

const steps = [
  { key: 'design', icon: PenTool },
  { key: 'paperwork', icon: FileText },
  { key: 'project', icon: ClipboardList },
] as const

export function HowItWorks() {
  const { t } = useTranslation('howItWorks')

  return (
    <Section id="how-it-works" className="bg-secondary/30">
      <div className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('subhead')}</p>
      </div>

      <ol className="mt-12 grid gap-10 sm:grid-cols-3">
        {steps.map(({ key, icon: Icon }, index) => (
          <li key={key} className="relative">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {t(`steps.${key}.step`)}
              </span>
              <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="mt-4 font-semibold text-foreground">{t(`steps.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`steps.${key}.body`)}</p>
            {index < steps.length - 1 && (
              <div
                className="absolute top-5 hidden h-px w-full bg-border sm:block end-[calc(50%+1.5rem)]"
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
    </Section>
  )
}
