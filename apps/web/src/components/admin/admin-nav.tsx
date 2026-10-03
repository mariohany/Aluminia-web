import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Building2, Users, Database, ScrollText } from 'lucide-react'
import { useDashboardSummaryQuery } from '@/lib/dashboard-queries'
import { useUsersQuery } from '@/lib/users-queries'
import { cn } from '@/lib/utils'

// Grouped as in the admin redesign (docs/admin_redesign_planing.md §1).
// `count` names which total, if any, sits at the end of the link.
const navGroups = [
  { key: 'overview', items: [{ to: '/app', key: 'nav.dashboard', icon: LayoutDashboard, end: true, count: null }] },
  {
    key: 'tenants',
    items: [
      { to: '/app/companies', key: 'nav.companies', icon: Building2, end: false, count: 'companies' },
      { to: '/app/users', key: 'nav.users', icon: Users, end: false, count: 'users' },
    ],
  },
  { key: 'catalogue', items: [{ to: '/app/data-warehouse', key: 'nav.dataWarehouse', icon: Database, end: false, count: null }] },
  { key: 'system', items: [{ to: '/app/logs', key: 'nav.logs', icon: ScrollText, end: false, count: null }] },
] as const

export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t, i18n } = useTranslation('admin')
  // Both already cached by the dashboard and the Users page; while they
  // load the link shows no number rather than a misleading 0.
  const { data: summary } = useDashboardSummaryQuery()
  const { data: users } = useUsersQuery()
  const numberFormatter = new Intl.NumberFormat(i18n.language)
  const counts = {
    companies: summary ? summary.companies.active + summary.companies.archived : null,
    users: users ? users.length : null,
  }

  return (
    <nav className="flex flex-col" aria-label={t('sidebar.navLabel')}>
      {navGroups.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          <span className="px-2.5 pt-3.5 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {t(`nav.groups.${group.key}`)}
          </span>
          {group.items.map(({ to, key, icon: Icon, end, count }) => {
            const value = count ? counts[count] : null
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    isActive
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'font-medium text-foreground hover:bg-accent',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn('size-4 shrink-0', !isActive && 'text-muted-foreground')} aria-hidden="true" />
                    {t(key)}
                    {value !== null && (
                      <span className="ms-auto font-mono text-[11px] font-normal text-muted-foreground">
                        {numberFormatter.format(value)}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
