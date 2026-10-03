import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

const THEMES = [
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
] as const

/**
 * Light / Dark, stored per browser by next-themes (key `aluminia.theme`,
 * see main.tsx) — Mario, 2026-10-02: app-wide dark mode. Until the user
 * picks one the theme stays "system" and follows the computer; the
 * button matching what the computer is using shows as selected
 * (Mario, 2026-10-03: no separate System button). Same segmented look
 * as `LanguageSwitcher`, so the two sit together in the admin sidebar.
 * The workspace rail uses the single-button `ThemeToggle` below instead.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { t } = useTranslation()
  // A client-only SPA: next-themes reads the stored choice synchronously,
  // so `theme` is already right on the first render (no mount guard).
  const { theme, resolvedTheme, setTheme } = useTheme()
  // "system" (no choice made yet) highlights whichever theme it resolves to.
  const current = theme === 'system' ? resolvedTheme : theme

  return (
    <div
      role="group"
      aria-label={t('theme.switchLabel')}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border p-0.5',
        className,
      )}
    >
      {THEMES.map(({ value, Icon }) => {
        const isActive = current === value
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
              'size-7',
              isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

/**
 * One icon button that flips between light and dark — the workspace
 * rail's version (docs/workspace_redesign_planing.md §1), where a
 * two-button group doesn't fit the 68px column. Shows the theme a click
 * switches TO, like the language toggle beside it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const current = theme === 'system' ? resolvedTheme : theme
  const next = current === 'dark' ? 'light' : 'dark'
  const Icon = next === 'dark' ? Moon : Sun

  return (
    <button
      type="button"
      aria-label={t(`theme.${next}`)}
      title={t(`theme.${next}`)}
      onClick={() => setTheme(next)}
      className={cn(
        'flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      <Icon className="size-[17px]" aria-hidden="true" />
    </button>
  )
}
