import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { supportedLanguages, type SupportedLanguage } from '@/lib/i18n'

export function LanguageSwitcher({
  className,
  compact = false,
}: {
  className?: string
  /** Shrinks padding/text for tight spots like the workspace rail (w-20). */
  compact?: boolean
}) {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage as SupportedLanguage

  return (
    <div
      role="group"
      aria-label={t('language.switchLabel')}
      className={cn(
        'inline-flex items-center rounded-md border border-border',
        compact ? 'gap-0.5 p-0.5' : 'gap-1 p-0.5',
        className,
      )}
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
              'rounded-[calc(var(--radius-sm))] font-medium uppercase transition-colors',
              compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
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
