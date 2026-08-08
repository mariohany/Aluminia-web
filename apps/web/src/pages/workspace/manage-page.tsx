import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal } from 'lucide-react'
import type { UserSummary } from '@repo/types/users'
import { useAuth } from '@/lib/auth-context'
import { useCompanyOverviewQuery } from '@/lib/company-queries'
import { useCompanyUsersQuery } from '@/lib/company-users-queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

  const [resettingUser, setResettingUser] = useState<UserSummary | null>(null)
  const [deletingUser, setDeletingUser] = useState<UserSummary | null>(null)
  const [actionTarget, setActionTarget] = useState<{ user: UserSummary; kind: CompanyUserActionKind } | null>(null)

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const seatsUsed = overview.data?.seatsUsed
  const maxUsers = overview.data?.maxUsers
  // Disabled rather than hidden at the limit: the button explains the
  // constraint (see the badge below) instead of the user discovering it
  // as a failed request. The server enforces the real limit regardless
  // — this is only about not inviting a failure that's already certain.
  const atSeatLimit = seatsUsed !== undefined && maxUsers !== undefined && seatsUsed >= maxUsers

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">{t('manage.title')}</h1>
          {seatsUsed !== undefined && maxUsers !== undefined && (
            <Badge variant={atSeatLimit ? 'destructive' : 'secondary'}>
              {t('manage.seats', { used: seatsUsed, max: maxUsers })}
            </Badge>
          )}
        </div>
        <CreateCompanyUserDialog disabled={atSeatLimit} />
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('manage.table.email')}</TableHead>
              <TableHead>{t('manage.table.status')}</TableHead>
              <TableHead>{t('manage.table.lastActivity')}</TableHead>
              <TableHead>{t('manage.table.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {t('tree.loading')}
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-destructive">
                  {t('manage.loadError')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && (users ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {t('manage.table.empty')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !isError &&
              (users ?? []).map((user) => {
                const isSelf = user.id === currentUser?.id
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium text-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.status === 'active' ? 'default' : 'outline'}>
                        {t(`manage.status.${user.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.online
                        ? t('manage.table.online')
                        : user.lastActiveAt
                          ? dateFormatter.format(new Date(user.lastActiveAt))
                          : t('manage.table.never')}
                    </TableCell>
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
                          {user.status === 'active' ? (
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
      </div>

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
