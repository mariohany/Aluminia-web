import { useTranslation } from 'react-i18next'
import { Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/layout/container'
import { WindowElevationIllustration } from '@/components/illustrations/window-elevation'

export function Hero() {
  const { t } = useTranslation('hero')
  const { t: tCommon } = useTranslation('common')

  return (
    <div className="border-b border-border bg-secondary/30">
      <Container className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-2 lg:py-28">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
            {t('headline')}
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">{t('subhead')}</p>

          <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Button asChild size="lg">
              <a href="#quote">{t('cta')}</a>
            </Button>
            <a
              href={`tel:${tCommon('phone.number')}`}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Phone className="size-4" aria-hidden="true" />
              {t('ctaSecondary')} <bdi>{tCommon('phone.number')}</bdi>
            </a>
          </div>
        </div>

        <div role="img" aria-label={t('visualAlt')} className="mx-auto w-full max-w-sm lg:max-w-none">
          <WindowElevationIllustration className="w-full" />
        </div>
      </Container>
    </div>
  )
}
