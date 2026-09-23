import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * The full-height "restoring your session" state, shared by the route
 * guards. The access token lives only in memory, so every page load
 * spends a round trip on `/auth/refresh` before it knows who you are —
 * this is what fills that gap without flashing the wrong page.
 */
export function RouteLoader() {
  const { t } = useTranslation('app')

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      <p>{t('loading')}</p>
    </div>
  )
}
