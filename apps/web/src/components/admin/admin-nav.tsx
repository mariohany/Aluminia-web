import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Building2, Users, Database, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/app', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/companies', key: 'nav.companies', icon: Building2, end: false },
  { to: '/app/users', key: 'nav.users', icon: Users, end: false },
  { to: '/app/data-warehouse', key: 'nav.dataWarehouse', icon: Database, end: false },
  { to: '/app/logs', key: 'nav.logs', icon: ScrollText, end: false },
] as const

export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('admin')

  return (
    <nav className="flex flex-col gap-1" aria-label={t('nav.dashboard')}>
      {navItems.map(({ to, key, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {t(key)}
        </NavLink>
      ))}
    </nav>
  )
}
