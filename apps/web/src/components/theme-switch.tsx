import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

const THEMES = [
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
  { value: 'system', Icon: Monitor },
] as const

/**
 * Light / Dark / System, stored per browser by next-themes (key
 * `aluminia.theme`, see main.tsx) — Mario, 2026-10-02: app-wide dark
 * mode, defaulting to whatever the computer uses. Same segmented look
 * and `compact` variant as `LanguageSwitcher`, so the two sit together
 * in the workspace rail and the admin sidebar.
 */
export function ThemeSwitch({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { t } = useTranslation()
  // A client-only SPA: next-themes reads the stored choice synchronously,
  // so `theme` is already right on the first render (no mount guard).
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label={t('theme.switchLabel')}
      className={cn(
        'inline-flex items-center rounded-md border border-border',
        compact ? 'gap-0.5 p-0.5' : 'gap-1 p-0.5',
        className,
      )}
    >
      {THEMES.map(({ value, Icon }) => {
        const isActive = theme === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isActive}
            aria-label={t(`theme.${value}`)}
            title={t(`theme.${value}`)}
            onClick={() => setTheme(value)}
            className={cn(
              'flex items-center justify-center rounded-[calc(var(--radius-sm))] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              compact ? 'size-[18px]' : 'size-7',
              isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className={compact ? 'size-3' : 'size-3.5'} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
