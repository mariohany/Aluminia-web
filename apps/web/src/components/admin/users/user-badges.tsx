import { useTranslation } from 'react-i18next'
import type { UserRole } from '@repo/types/auth'
import type { UserSummary } from '@repo/types/users'
import { NeutralPill } from '@/components/admin/companies/company-badges'
import { cn } from '@/lib/utils'

/** First two letters of the email, standing in for a profile picture. */
export function UserAvatar({ email }: { email: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-[10px] font-semibold text-foreground uppercase"
    >
      {email.slice(0, 2)}
    </span>
  )
}

/** Role pill: blue for super admin, primary tint for company admin, grey for user. */
export function UserRolePill({ role }: { role: UserRole }) {
  const { t } = useTranslation('admin')
  return (
    <NeutralPill
      className={cn(
        role === 'super_admin' && 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
        role === 'company_admin' && 'bg-primary/10 text-primary',
      )}
    >
      {t(`usersPage.role.${role}`)}
    </NeutralPill>
  )
}

/** "● Online", else the last activity date, else "Never". */
export function LastActivity({ user, formatter }: { user: UserSummary; formatter: Intl.DateTimeFormat }) {
  const { t } = useTranslation('admin')
  if (user.online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        {t('usersPage.table.online')}
      </span>
    )
  }
  return (
    <span className="text-muted-foreground">
      {user.lastActiveAt ? formatter.format(new Date(user.lastActiveAt)) : t('usersPage.table.never')}
    </span>
  )
}
