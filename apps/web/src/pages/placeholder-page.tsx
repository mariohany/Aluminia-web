import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/layout/container'

export function PlaceholderPage({ titleKey, bodyKey }: { titleKey: string; bodyKey: string }) {
  const { t } = useTranslation()

  return (
    <Container className="flex min-h-[70svh] flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t(titleKey)}</h1>
      <p className="max-w-md text-muted-foreground">{t(bodyKey)}</p>
      <Button asChild variant="outline" className="mt-4">
        <Link to="/">{t('placeholder.backHome')}</Link>
      </Button>
    </Container>
  )
}
