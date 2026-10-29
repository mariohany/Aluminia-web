import { useTranslation } from 'react-i18next'
import { CompanyStatus } from '@repo/types/companies'
import type { PlanKey } from '@repo/types/plans'
import { subscriptionState } from '@repo/types/subscriptions'
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

const TONE_PILL = {
  yellow: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  red: 'bg-destructive/10 text-destructive',
} as const

/**
 * The header tag next to the name and plan (B19, boards `bill-cd-b-*`):
 * "Ends in N days" only in the last 30 days, yellow, red from 5;
 * "Expired" once a paid plan ran out; a trial always says so.
 */
export function SubscriptionTag({
  company,
}: {
  company: { plan: { key: PlanKey }; endsAt: string | null; isTrial: boolean }
}) {
  const { t } = useTranslation('admin')
  const state = subscriptionState({ planKey: company.plan.key, endsAt: company.endsAt, isTrial: company.isTrial }, new Date())

  let text: string | null = null
  let tone: keyof typeof TONE_PILL | null = null
  if (state.kind === 'expired') {
    text = t('companyDetail.tag.expired')
    tone = 'red'
  } else if (state.kind === 'trial') {
    text = t('companyDetail.tag.trial', { count: state.daysLeft })
    tone = state.tone
  } else if (state.kind === 'ending') {
    text = t('companyDetail.tag.ends', { count: state.daysLeft })
    tone = state.tone
  }
  if (!text) return null
  return (
    <span
      className={cn(
        'inline-flex h-5.5 items-center gap-1.5 rounded-full px-2 text-xs font-medium',
        tone ? TONE_PILL[tone] : 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {text}
    </span>
  )
}
