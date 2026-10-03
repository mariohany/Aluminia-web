import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react'
import { PLATFORM_COMPANY_LIMIT } from '@repo/types/companies'
import { useAuth } from '@/lib/auth-context'
import { useDashboardSummaryQuery } from '@/lib/dashboard-queries'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeSwitch } from '@/components/theme-switch'
import { AdminNav } from '@/components/admin/admin-nav'
import { CapacityBar } from '@/components/admin/capacity-bar'

/**
 * The admin console's sidebar (docs/admin_redesign_planing.md §1): brand,
 * grouped nav with counts, the platform-capacity card, then the account
 * row with language and theme. Shared by the desktop aside and the
 * mobile sheet in `AdminLayout`.
 */
export function AdminSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t, i18n } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { data: summary } = useDashboardSummaryQuery()

  const handleLogout = async () => {
    await logout()
    void navigate('/login', { replace: true })
  }

  const numberFormatter = new Intl.NumberFormat(i18n.language)
  const companyCount = summary ? summary.companies.active + summary.companies.archived : null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-1.5 pb-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading font-bold text-primary-foreground"
        >
          A
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="font-heading text-[15px] font-semibold text-foreground">{tCommon('appName')}</span>
          <span className="text-[11px] text-muted-foreground">{t('sidebar.console')}</span>
        </div>
      </div>

      <AdminNav onNavigate={onNavigate} />

      <div className="mt-auto flex flex-col gap-3 pt-4">
        {companyCount !== null && (
          <CapacityCard
            label={t('sidebar.capacity')}
            used={companyCount}
            value={t('sidebar.capacityValue', {
              used: numberFormatter.format(companyCount),
              limit: numberFormatter.format(PLATFORM_COMPANY_LIMIT),
            })}
          />
        )}

        <div className="flex items-center gap-2.5 border-t border-border px-1.5 pt-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-foreground uppercase"
          >
            {user?.email.slice(0, 2)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={user?.email}>
            {user?.email}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={t('sidebar.logout')}
            title={t('sidebar.logout')}
            onClick={() => void handleLogout()}
          >
            <LogOut className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 px-1.5">
          <LanguageSwitcher />
          <ThemeSwitch />
        </div>
      </div>
    </div>
  )
}

/** "Platform capacity  37 / 250" over the capacity bar. */
function CapacityCard({ label, used, value }: { label: string; used: number; value: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs text-foreground" dir="ltr">
          {value}
        </span>
      </div>
      <CapacityBar used={used} label={label} valueText={value} />
    </div>
  )
}
