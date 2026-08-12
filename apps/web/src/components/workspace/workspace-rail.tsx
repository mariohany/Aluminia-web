import { Link, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Database, LayoutGrid, LogOut, Menu, Settings } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/language-switcher'
import { cn } from '@/lib/utils'

/**
 * The workspace's top-level navigation: an icon rail, not a sidebar.
 * `Manage` replaces the tree and canvas entirely rather than sitting
 * beside them, so these are destinations, not filters.
 *
 * Always visible, at every breakpoint — there is no separate top bar.
 * Below `lg`, where the client/project tree panel is hidden, the rail
 * is the tree's only way back: `onOpenTree` (when provided) renders a
 * menu button that opens it in a Sheet.
 */
export function WorkspaceRail({
  onNavigate,
  onOpenTree,
}: {
  onNavigate?: () => void
  onOpenTree?: () => void
}) {
  const { t } = useTranslation('workspace')
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const handleLogout = async () => {
    await logout()
    void navigate('/login', { replace: true })
  }

  // Not NavLink's own `isActive`, deliberately. `end` would switch the
  // Projects item off as soon as a project is selected — the rail would
  // claim you had left the section you were plainly still in — while
  // dropping `end` would light it up on the Data/Manage routes too,
  // since /workspace prefixes everything here. The rail has exactly
  // three destinations, so state the active one directly rather than
  // deriving three separate booleans.
  const section = pathname.startsWith('/workspace/manage')
    ? 'manage'
    : pathname.startsWith('/workspace/data')
      ? 'data'
      : 'projects'

  // Fixed square footprint, not padding sized to the label — "Projects"
  // and "Data" are different lengths, and without a fixed size each
  // pill was only as wide as its own text, so the three destinations
  // didn't line up as matching squares.
  const itemClass = (isActive: boolean) =>
    cn(
      'flex size-14 shrink-0 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium',
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    )

  return (
    <nav className="flex h-full w-17 shrink-0 flex-col items-center gap-1.5 border-e border-border bg-background py-3">
      {onOpenTree && (
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={t('openMenu')}
          onClick={onOpenTree}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      )}

      <Link
        to="/workspace"
        className={itemClass(section === 'projects')}
        aria-current={section === 'projects' ? 'page' : undefined}
        onClick={onNavigate}
      >
        <LayoutGrid className="size-5" aria-hidden="true" />
        {t('rail.projects')}
      </Link>

      <Link
        to="/workspace/data"
        className={itemClass(section === 'data')}
        aria-current={section === 'data' ? 'page' : undefined}
        onClick={onNavigate}
      >
        <Database className="size-5" aria-hidden="true" />
        {t('rail.data')}
      </Link>

      {/* Hidden for plain users. The server guard is the real boundary —
          every /company/users route is @Roles(COMPANY_ADMIN) — so this
          is courtesy, not security: a link that always 403s is worse
          than no link. */}
      {user?.role === UserRole.COMPANY_ADMIN && (
        <Link
          to="/workspace/manage"
          className={itemClass(section === 'manage')}
          aria-current={section === 'manage' ? 'page' : undefined}
          onClick={onNavigate}
        >
          <Settings className="size-5" aria-hidden="true" />
          {t('rail.manage')}
        </Link>
      )}

      <div className="mt-auto flex flex-col items-center gap-2">
        <LanguageSwitcher compact />

        <Button
          variant="ghost"
          size="icon"
          aria-label={t('rail.logout')}
          onClick={() => void handleLogout()}
        >
          <LogOut className="size-5" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
