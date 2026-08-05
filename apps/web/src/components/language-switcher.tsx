import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { supportedLanguages, type SupportedLanguage } from '@/lib/i18n'

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage as SupportedLanguage

  return (
    <div
      role="group"
      aria-label={t('language.switchLabel')}
      className={cn('inline-flex items-center gap-1 rounded-md border border-border p-0.5', className)}
    >
      {supportedLanguages.map((lng) => {
        const isActive = current === lng
        return (
          <button
            key={lng}
            type="button"
            aria-current={isActive ? 'true' : undefined}
            disabled={isActive}
            onClick={() => void i18n.changeLanguage(lng)}
            className={cn(
              'rounded-[calc(var(--radius-sm))] px-2 py-1 text-xs font-medium uppercase transition-colors',
              isActive
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground disabled:cursor-default',
            )}
          >
            {lng}
          </button>
        )
      })}
    </div>
  )
}
