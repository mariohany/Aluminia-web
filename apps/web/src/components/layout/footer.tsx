import { Link } from 'react-router'
import { Phone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Container } from '@/components/layout/container'

export function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border bg-secondary/40">
      <Container className="py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="text-lg font-semibold tracking-tight text-foreground">{t('appName')}</p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t('footer.tagline')}</p>
          </div>

          <div>
            <p className="text-sm font-semibold text-foreground">{t('footer.contact')}</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <a href={`tel:${t('phone.number')}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="size-4" aria-hidden="true" />
                  <bdi>{t('phone.number')}</bdi>
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold text-foreground">{t('footer.legal')}</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to="/privacy" className="hover:text-foreground">
                  {t('footer.privacy')}
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-foreground">
                  {t('footer.terms')}
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-foreground">
                  {t('nav.login')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            {t('footer.copyright', { year, appName: t('appName') })}
          </p>
          <LanguageSwitcher />
        </div>
      </Container>
    </footer>
  )
}
