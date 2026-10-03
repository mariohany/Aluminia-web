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
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border p-0.5',
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

// Each language written in itself, so the button reads correctly to
// someone who can't read the current UI language.
const OWN_NAME: Record<SupportedLanguage, string> = { en: 'EN', ar: 'ع' }

/**
 * One button that switches to the other language — the workspace rail's
 * version (docs/workspace_redesign_planing.md §1). With exactly two
 * languages, "the other one" is unambiguous.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage as SupportedLanguage
  const next = supportedLanguages.find((lng) => lng !== current) ?? 'en'

  return (
    <button
      type="button"
      lang={next}
      aria-label={t(`language.${next}`)}
      title={t(`language.${next}`)}
      onClick={() => void i18n.changeLanguage(next)}
      className={cn(
        'flex size-9 items-center justify-center rounded-lg text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      {OWN_NAME[next]}
    </button>
  )
}
