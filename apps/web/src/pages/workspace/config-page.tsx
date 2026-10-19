import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Building2, ChevronRight, ListChecks, Users, type LucideIcon } from 'lucide-react'
import { useCompanyOverviewQuery } from '@/lib/company-queries'

/**
 * The Config home (was Manage): one card per section, each opening its
 * own page under /workspace/config/<section>. Cards carry a title and a
 * description only — no live details (Mario, 2026-10-17). Company admins
 * only (the route's RoleRoute). Add a section = an entry here + a route
 * + `config.sections.<key>` en/ar keys.
 */
const SECTIONS: { key: string; to: string; icon: LucideIcon }[] = [
  { key: 'users', to: '/workspace/config/users', icon: Users },
  { key: 'company', to: '/workspace/config/company', icon: Building2 },
  { key: 'projects', to: '/workspace/config/projects', icon: ListChecks },
]

export function ConfigPage() {
  const { t } = useTranslation('workspace')
  const overview = useCompanyOverviewQuery()

  return (
    <div className="flex flex-col gap-5 p-4 md:px-9 md:py-7">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('config.title')}</h1>
        {overview.data && (
          <p className="truncate text-sm text-muted-foreground">
            {t('rail.companyPlan', {
              company: overview.data.name,
              plan: overview.data.plan,
            })}
          </p>
        )}
      </div>

      {/* `auto-rows-fr` + `h-full`: every card the height of the tallest, so the grid reads as equal tiles whatever the description length. */}
      <ul className="grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map(({ key, to, icon: Icon }) => (
          <li key={key}>
            <Link
              to={to}
              className="flex h-full items-center gap-3.5 rounded-[14px] border border-border bg-card p-5 shadow-xs transition-colors outline-none hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-foreground">{t(`config.sections.${key}.title`)}</span>
                <span className="text-[12.5px] leading-snug text-muted-foreground">
                  {t(`config.sections.${key}.description`)}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
