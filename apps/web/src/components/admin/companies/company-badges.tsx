import { useTranslation } from 'react-i18next'
import { CompanyStatus } from '@repo/types/companies'
import { cn } from '@/lib/utils'

/** "Gulf Facades" → "GF". */
function companyInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

/** Initials tile standing in for a company logo (Companies list, company page). */
export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-foreground',
        className,
      )}
    >
      {companyInitials(name)}
    </span>
  )
}

/** Green pill for an active company / user, grey otherwise. No dot (Mario, 2026-10-03). */
export function StatusPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 items-center rounded-full px-2 text-xs font-medium',
        active ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

/** "Active" / "Archived" for a company. */
export function CompanyStatusPill({ status }: { status: CompanyStatus }) {
  const { t } = useTranslation('admin')
  return <StatusPill active={status === CompanyStatus.ACTIVE}>{t(`companiesPage.status.${status}`)}</StatusPill>
}

/** Neutral pill for free-text values like the plan or a user's role. */
export function NeutralPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 items-center rounded-full bg-secondary px-2 text-xs font-medium text-secondary-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}
