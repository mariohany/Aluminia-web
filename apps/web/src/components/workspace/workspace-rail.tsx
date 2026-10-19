import { Link, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Database, FileChartColumn, LayoutGrid, LogOut, Menu, Settings } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import { useAuth } from '@/lib/auth-context'
import { useCompanyOverviewQuery } from '@/lib/company-queries'
import { useCompanyProfileQuery } from '@/lib/company-profile-queries'
import { useFileObjectUrl } from '@/lib/files-queries'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LanguageToggle } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-switch'
import { cn } from '@/lib/utils'

/**
 * The workspace's top-level navigation: an icon rail, not a sidebar.
 * `Config` replaces the tree and canvas entirely rather than sitting
 * beside them, so these are destinations, not filters.
 *
 * Always visible, at every breakpoint — there is no separate top bar.
 * Below `lg`, where the client/project tree panel is hidden, the rail
 * is the tree's only way back: `onOpenTree` (when provided) renders a
 * menu button that opens it in a Sheet.
 *
 * Redesign (docs/workspace_redesign_planing.md §1): brand mark on top,
 * theme + language as single toggles, and the account behind the
 * avatar — its menu carries the email, role, company and Log out.
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
  // Open to plain users too (CompanyController) — the company's name and
  // plan belong in everyone's account menu.
  const { data: company } = useCompanyOverviewQuery()
  // Readable by plain users too (CompanyProfileController); Save in
  // Config replaces this cache, so a new logo shows here at once.
  const { data: profile } = useCompanyProfileQuery()
  const logoUrl = useFileObjectUrl(profile?.logoFileId)
  // Radix places by physical side and there is no DirectionProvider, so
  // "toward the canvas" is right in English and left in Arabic.
  const menuSide = document.documentElement.dir === 'rtl' ? 'left' : 'right'
  const { pathname } = useLocation()

  const handleLogout = async () => {
    await logout()
    void navigate('/login', { replace: true })
  }

  // Not NavLink's own `isActive`, deliberately. `end` would switch the
  // Projects item off as soon as a project is selected — the rail would
  // claim you had left the section you were plainly still in — while
  // dropping `end` would light it up on the Data/Config routes too,
  // since /workspace prefixes everything here. The rail has exactly
  // four destinations, so state the active one directly rather than
  // deriving three separate booleans.
  const section = pathname.startsWith('/workspace/config')
    ? 'config'
    : pathname.startsWith('/workspace/data')
      ? 'data'
      : pathname.startsWith('/workspace/reports')
        ? 'reports'
        : 'projects'

  // Fixed square footprint, not padding sized to the label — "Projects"
  // and "Data" are different lengths, and without a fixed size each
  // pill was only as wide as its own text, so the three destinations
  // didn't line up as matching squares.
  const itemClass = (isActive: boolean) =>
    cn(
      'flex size-13 shrink-0 flex-col items-center justify-center gap-[3px] rounded-[10px] text-[10.5px] font-medium',
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    )

  const roleLabel = user?.role === UserRole.COMPANY_ADMIN ? t('roles.company_admin') : t('roles.user')

  return (
    <nav className="flex h-full w-17 shrink-0 flex-col items-center gap-1.5 border-e border-border bg-card py-3.5">
      {/* The company profile's logo, in the same square as the nav items
          below so every company's rail lines up whatever the logo's
          shape: `object-contain` shows the whole logo, never cropped.
          Without one, the admin sidebar's brand mark at that size. */}
      {logoUrl ? (
        <span className="mb-2.5 flex size-13 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-muted p-1">
          <img src={logoUrl} alt={company?.name ?? ''} className="size-full object-contain" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="mb-2.5 flex size-13 shrink-0 items-center justify-center rounded-[10px] bg-primary font-heading text-xl font-bold text-primary-foreground"
        >
          A
        </span>
      )}

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
        <LayoutGrid className="size-[19px]" aria-hidden="true" />
        {t('rail.projects')}
      </Link>

      {/* Every company user (docs/reports_planing.md D10). */}
      <Link
        to="/workspace/reports"
        className={itemClass(section === 'reports')}
        aria-current={section === 'reports' ? 'page' : undefined}
        onClick={onNavigate}
      >
        <FileChartColumn className="size-[19px]" aria-hidden="true" />
        {t('rail.reports')}
      </Link>

      <Link
        to="/workspace/data"
        className={itemClass(section === 'data')}
        aria-current={section === 'data' ? 'page' : undefined}
        onClick={onNavigate}
      >
        <Database className="size-[19px]" aria-hidden="true" />
        {t('rail.data')}
      </Link>

      {/* Hidden for plain users. The server guard is the real boundary —
          every /company/users route is @Roles(COMPANY_ADMIN) — so this
          is courtesy, not security: a link that always 403s is worse
          than no link. */}
      {user?.role === UserRole.COMPANY_ADMIN && (
        <Link
          to="/workspace/config"
          className={itemClass(section === 'config')}
          aria-current={section === 'config' ? 'page' : undefined}
          onClick={onNavigate}
        >
          <Settings className="size-[19px]" aria-hidden="true" />
          {t('rail.config')}
        </Link>
      )}

      <div className="mt-auto flex flex-col items-center gap-1">
        <ThemeToggle />
        <LanguageToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('rail.account')}
              title={user?.email}
              className="mt-1 flex size-[34px] items-center justify-center rounded-full bg-accent text-xs font-semibold text-foreground uppercase outline-none hover:ring-2 hover:ring-border focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {user?.email.slice(0, 2)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={menuSide} align="end" className="w-64">
            <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
              <span className="truncate text-sm font-medium text-foreground" title={user?.email}>
                {user?.email}
              </span>
              <span className="text-xs text-muted-foreground">{roleLabel}</span>
              {company && (
                <span className="truncate text-xs text-muted-foreground">
                  {t('rail.companyPlan', { company: company.name, plan: company.plan })}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void handleLogout()}>
              <LogOut className="rtl:rotate-180" aria-hidden="true" />
              {t('rail.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}
