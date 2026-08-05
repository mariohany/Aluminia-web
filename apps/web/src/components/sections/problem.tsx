import { useTranslation } from 'react-i18next'
import { Copy, FileWarning, MessagesSquare, Ruler } from 'lucide-react'
import { Section } from '@/components/layout/section'

const items = [
  { key: 'quote', icon: Copy },
  { key: 'measurements', icon: Ruler },
  { key: 'specs', icon: FileWarning },
  { key: 'tracking', icon: MessagesSquare },
] as const

export function Problem() {
  const { t } = useTranslation('problem')

  return (
    <Section id="problem">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">{t('eyebrow')}</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('subhead')}</p>
      </div>

      <div className="mt-12 grid gap-8 sm:grid-cols-2">
        {items.map(({ key, icon: Icon }) => (
          <div key={key} className="flex gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary">
              <Icon className="size-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{t(`items.${key}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`items.${key}.body`)}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
