import { useState } from 'react'
import { Link } from 'react-router'
import { Menu, Phone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Container } from '@/components/layout/container'
import { isRtlLanguage } from '@/lib/i18n'

const navItems = [
  { href: '#how-it-works', key: 'nav.howItWorks' },
  { href: '#features', key: 'nav.features' },
  { href: '#faq', key: 'nav.faq' },
] as const

export function Header() {
  const { t, i18n } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileSheetSide = isRtlLanguage(i18n.resolvedLanguage ?? 'en') ? 'left' : 'right'

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between gap-4">
        <a href="#top" className="text-lg font-semibold tracking-tight text-foreground">
          {t('appName')}
        </a>

        <nav className="hidden items-center gap-6 md:flex" aria-label={t('nav.howItWorks')}>
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(item.key)}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href={`tel:${t('phone.number')}`}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Phone className="size-4" aria-hidden="true" />
            <bdi>{t('phone.number')}</bdi>
          </a>
          <LanguageSwitcher />
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">{t('nav.login')}</Link>
          </Button>
          <Button asChild size="sm">
            <a href="#quote">{t('nav.requestQuote')}</a>
          </Button>
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('nav.howItWorks')}>
              <Menu className="size-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side={mobileSheetSide} className="w-72">
            <SheetHeader>
              <SheetTitle>{t('appName')}</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-4 px-4" aria-label={t('nav.howItWorks')}>
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="text-sm font-medium text-foreground"
                >
                  {t(item.key)}
                </a>
              ))}
              <Separator />
              <a
                href={`tel:${t('phone.number')}`}
                className="flex items-center gap-1.5 text-sm font-medium text-foreground"
              >
                <Phone className="size-4" aria-hidden="true" />
                {t('phone.number')}
              </a>
              <LanguageSwitcher className="self-start" />
              <Separator />
              <Link to="/login" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-foreground">
                {t('nav.login')}
              </Link>
              <Button asChild onClick={() => setMobileOpen(false)}>
                <a href="#quote">{t('nav.requestQuote')}</a>
              </Button>
            </nav>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  )
}
