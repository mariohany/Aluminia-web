import { useTranslation } from 'react-i18next'
import { ClipboardList, FileText, PenTool, Users } from 'lucide-react'
import { Section } from '@/components/layout/section'

const items = [
  { key: 'designer', icon: PenTool },
  { key: 'paperwork', icon: FileText },
  { key: 'projects', icon: ClipboardList },
  { key: 'customers', icon: Users },
] as const

export function Features() {
  const { t } = useTranslation('features')

  return (
    <Section id="features">
      <div className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('subhead')}</p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ key, icon: Icon }) => (
          <div key={key} className="rounded-lg border border-border p-6">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary/10">
              <Icon className="size-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-4 font-semibold text-foreground">{t(`items.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`items.${key}.body`)}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}
