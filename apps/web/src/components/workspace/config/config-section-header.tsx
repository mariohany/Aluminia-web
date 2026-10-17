import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Top of every Config section page: a back button and a
 * "Config › <section>" breadcrumb, both leading to the Config home.
 */
export function ConfigSectionHeader({ title }: { title: string }) {
  const { t } = useTranslation('workspace')

  return (
    <nav aria-label={t('config.title')} className="flex items-center gap-2.5">
      <Button variant="outline" size="icon" className="size-8" asChild>
        <Link to="/workspace/config" aria-label={t('config.back')}>
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </Button>
      <Link to="/workspace/config" className="text-[13px] text-muted-foreground hover:text-foreground">
        {t('config.title')}
      </Link>
      <ChevronRight className="size-3 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
      <span aria-current="page" className="text-[13px] font-semibold text-foreground">
        {title}
      </span>
    </nav>
  )
}
