import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Plus } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import type { UserSummary } from '@repo/types/users'
import { useAuth } from '@/lib/auth-context'
import { useCompanyOverviewQuery } from '@/lib/company-queries'
import { useCompanyUsersQuery } from '@/lib/company-users-queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreateCompanyUserDialog } from '@/components/workspace/manage/create-company-user-dialog'
import { ResetCompanyUserPasswordDialog } from '@/components/workspace/manage/reset-company-user-password-dialog'
import { DeleteCompanyUserDialog } from '@/components/workspace/manage/delete-company-user-dialog'
import {
  CompanyUserActionDialog,
  type CompanyUserActionKind,
} from '@/components/workspace/manage/company-user-action-dialog'

/**
 * The company-admin user surface. Step 10 of Phase 11, scoped
 * deliberately to users only — company profile/settings is a later
 * pass, agreed with the user rather than assumed.
 *
 * Structurally simpler than the admin console's users table on purpose:
 * every row is already this company's, every role is `user`, and there
 * is no edit action — CompanyUsersController has no PATCH route, because
 * there is no other role or company for a company admin to move a
 * colleague to on this surface.
 */
export function ManagePage() {
  const { t, i18n } = useTranslation('workspace')
  const { user: currentUser } = useAuth()
  const { data: users, isLoading, isError } = useCompanyUsersQuery()
  const overview = useCompanyOverviewQuery()

  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [resettingUser, setResettingUser] = useState<UserSummary | null>(null)
  const [deletingUser, setDeletingUser] = useState<UserSummary | null>(null)
  const [actionTarget, setActionTarget] = useState<{ user: UserSummary; kind: CompanyUserActionKind } | null>(null)

  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }), [i18n.language])

  const team = users ?? []
  const term = search.trim().toLowerCase()
  const visibleUsers = term ? team.filter((u) => u.email.toLowerCase().includes(term)) : team
  const onlineCount = team.filter((u) => u.online).length

  const seatsUsed = overview.data?.seatsUsed
  const maxUsers = overview.data?.maxUsers
  // Disabled rather than hidden at the limit: the button explains the
  // constraint (see the seats card) instead of the user discovering it
  // as a failed request. The server enforces the real limit regardless
  // — this is only about not inviting a failure that's already certain.
  const atSeatLimit = seatsUsed !== undefined && maxUsers !== undefined && seatsUsed >= maxUsers
  const freeSeats = seatsUsed !== undefined && maxUsers !== undefined ? Math.max(0, maxUsers - seatsUsed) : 0

  return (
    <div className="flex flex-col gap-4 p-4 md:px-7 md:py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('manage.title')}</h1>
          {overview.data && (
            <p className="truncate text-sm text-muted-foreground">
              {t('rail.companyPlan', { company: overview.data.name, plan: overview.data.plan })}
            </p>
          )}
        </div>
        <CreateCompanyUserDialog disabled={atSeatLimit} open={addOpen} onOpenChange={setAddOpen} />
      </div>

      {/* Seats (workspace redesign §5): the bar, what's left, who's on,
          then one avatar per member and a dashed slot per free seat. */}
      {seatsUsed !== undefined && maxUsers !== undefined && (
        <section className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 shadow-xs">
          <div className="flex w-64 max-w-full flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-foreground">{t('manage.seatsTitle')}</h2>
              <span className="font-mono text-[13px] text-foreground" dir="ltr">
                {seatsUsed} / {maxUsers}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={t('manage.seatsTitle')}
              aria-valuemin={0}
              aria-valuemax={maxUsers}
              aria-valuenow={seatsUsed}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn('h-full rounded-full', atSeatLimit ? 'bg-destructive' : 'bg-primary')}
                style={{ width: `${maxUsers > 0 ? Math.min(100, (seatsUsed / maxUsers) * 100) : 0}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {atSeatLimit ? t('manage.seatsFull') : t('manage.seatsLeft', { count: freeSeats })}
              {' · '}
              {t('manage.onlineNow', { count: onlineCount })}
            </span>
          </div>

          <span className="hidden h-12 w-px bg-border sm:block" aria-hidden="true" />

          <ul className="flex flex-wrap items-center gap-2">
            {team.map((member) => (
              <li key={member.id}>
                <Avatar email={member.email} muted={member.status !== 'active'} online={member.online} size="md" />
              </li>
            ))}
            {Array.from({ length: freeSeats }, (_, index) => (
              <li key={`free-${index}`}>
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  aria-label={t('manage.addUserSlot')}
                  title={t('manage.addUserSlot')}
                  className="flex size-[34px] items-center justify-center rounded-full border-[1.5px] border-dashed border-border text-muted-foreground transition-colors outline-none hover:border-primary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-3">
          <h2 className="text-[15px] font-semibold text-foreground">{t('manage.teamTitle')}</h2>
          {users && <span className="font-mono text-[11px] text-muted-foreground">{team.length}</span>}
          <SearchInput
            icon
            value={search}
            onChange={setSearch}
            placeholder={t('manage.searchPlaceholder')}
            aria-label={t('manage.searchPlaceholder')}
            className="ms-auto w-full max-w-60"
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-3.5">{t('manage.table.user')}</TableHead>
              <TableHead>{t('manage.table.role')}</TableHead>
              <TableHead>{t('manage.table.status')}</TableHead>
              <TableHead>{t('manage.table.lastActivity')}</TableHead>
              <TableHead>{t('manage.table.added')}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t('manage.table.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t('tree.loading')}
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-destructive">
                  {t('manage.loadError')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && team.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t('manage.table.empty')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && team.length > 0 && visibleUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t('manage.noMatches')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !isError &&
              visibleUsers.map((user) => {
                const isSelf = user.id === currentUser?.id
                const isActive = user.status === 'active'
                return (
                  <TableRow key={user.id}>
                    <TableCell className="ps-3.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar email={user.email} muted={!isActive} size="sm" />
                        <span className="truncate font-medium text-foreground" dir="ltr">
                          {user.email}
                        </span>
                        {isSelf && <Chip tone="info">{t('manage.you')}</Chip>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Chip tone={user.role === UserRole.COMPANY_ADMIN ? 'primary' : 'muted'}>
                        {user.role === UserRole.COMPANY_ADMIN ? t('roles.company_admin') : t('roles.user')}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Chip tone={isActive ? 'ok' : 'muted'}>{t(`manage.status.${user.status}`)}</Chip>
                    </TableCell>
                    <TableCell>
                      {user.online ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                          {t('manage.table.onlineNow')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {user.lastActiveAt ? dateTimeFormatter.format(new Date(user.lastActiveAt)) : t('manage.table.never')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{dateFormatter.format(new Date(user.createdAt))}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t('manage.table.actions')}>
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setResettingUser(user)}>
                            {t('manage.actions.resetPassword')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {isActive ? (
                            <DropdownMenuItem
                              disabled={isSelf}
                              onSelect={() => setActionTarget({ user, kind: 'deactivate' })}
                            >
                              {t('manage.actions.deactivate')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => setActionTarget({ user, kind: 'reactivate' })}>
                              {t('manage.actions.reactivate')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isSelf}
                            onSelect={() => setDeletingUser(user)}
                          >
                            {t('manage.actions.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
          </TableBody>
        </Table>
      </section>

      <ResetCompanyUserPasswordDialog
        user={resettingUser}
        open={!!resettingUser}
        onOpenChange={(open) => !open && setResettingUser(null)}
      />
      <DeleteCompanyUserDialog
        user={deletingUser}
        open={!!deletingUser}
        onOpenChange={(open) => !open && setDeletingUser(null)}
      />
      <CompanyUserActionDialog
        user={actionTarget?.user ?? null}
        kind={actionTarget?.kind ?? null}
        open={!!actionTarget}
        onOpenChange={(open) => !open && setActionTarget(null)}
      />
    </div>
  )
}


/** Two-letter initials off the email, round; dimmed for a deactivated member. */
function Avatar({
  email,
  muted = false,
  online = false,
  size,
}: {
  email: string
  muted?: boolean
  online?: boolean
  size: 'sm' | 'md'
}) {
  return (
    <span className="relative inline-flex shrink-0" title={email}>
      <span
        aria-hidden="true"
        className={cn(
          'flex items-center justify-center rounded-full font-semibold uppercase',
          size === 'md' ? 'size-[34px] text-xs' : 'size-[30px] text-[11px]',
          muted ? 'bg-muted text-muted-foreground' : 'bg-accent text-foreground',
        )}
      >
        {email.slice(0, 2)}
      </span>
      <span className="sr-only">{email}</span>
      {online && (
        <span
          aria-hidden="true"
          className="absolute -end-px -bottom-px size-2.5 rounded-full border-2 border-card bg-emerald-500"
        />
      )}
    </span>
  )
}

// Same tones as the admin console's user/status pills
// (components/admin/users/user-badges.tsx, companies/company-badges.tsx).
const CHIP_TONE = {
  primary: 'bg-primary/10 text-primary',
  ok: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  muted: 'bg-muted text-muted-foreground',
} as const

function Chip({ tone, children }: { tone: keyof typeof CHIP_TONE; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 items-center rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap',
        CHIP_TONE[tone],
      )}
    >
      {children}
    </span>
  )
}
