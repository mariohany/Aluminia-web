import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, LogOut, MoreHorizontal, Pencil, Power, PowerOff, Trash2 } from 'lucide-react'
import type { UserSummary } from '@repo/types/users'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EditUserDialog } from '@/components/admin/users/edit-user-dialog'
import { ResetPasswordDialog } from '@/components/admin/users/reset-password-dialog'
import { DeleteUserDialog } from '@/components/admin/users/delete-user-dialog'
import { UserActionDialog, type UserActionKind } from '@/components/admin/users/user-action-dialog'

/**
 * A user row's ⋯ menu and the dialogs behind it: Edit, Reset password,
 * End session, Deactivate / Reactivate, Delete permanently. Shared by the
 * Users page and the company page's Users card, so both behave the same.
 * Render `renderMenu(user)` in each row and `dialogs` once on the page.
 * The signed-in admin can't deactivate or delete themselves.
 */
export function useUserRowActions() {
  const { t, i18n } = useTranslation('admin')
  const { user: currentUser } = useAuth()

  const [editingUser, setEditingUser] = useState<UserSummary | null>(null)
  const [resettingUser, setResettingUser] = useState<UserSummary | null>(null)
  const [deletingUser, setDeletingUser] = useState<UserSummary | null>(null)
  const [actionTarget, setActionTarget] = useState<{ user: UserSummary; kind: UserActionKind } | null>(null)

  // Radix positions by physical side (no DirectionProvider): hang the
  // menu off the row's end, which is the left edge in Arabic.
  const align = i18n.dir() === 'rtl' ? 'start' : 'end'

  const renderMenu = (user: UserSummary) => {
    const isSelf = user.id === currentUser?.id
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('usersPage.actions.menuLabel', { email: user.email })}>
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-auto min-w-44 whitespace-nowrap *:data-[slot=dropdown-menu-item]:gap-2.5 *:data-[slot=dropdown-menu-item]:px-2.5 *:data-[slot=dropdown-menu-item]:py-1.5">
          <DropdownMenuItem onClick={() => setEditingUser(user)}>
            <Pencil className="text-muted-foreground" aria-hidden="true" />
            {t('usersPage.actions.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setResettingUser(user)}>
            <KeyRound className="text-muted-foreground" aria-hidden="true" />
            {t('usersPage.actions.resetPassword')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setActionTarget({ user, kind: 'end-session' })}>
            <LogOut className="text-muted-foreground rtl:rotate-180" aria-hidden="true" />
            {t('usersPage.actions.endSession')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.status === 'active' ? (
            <DropdownMenuItem disabled={isSelf} onClick={() => setActionTarget({ user, kind: 'deactivate' })}>
              <PowerOff className="text-muted-foreground" aria-hidden="true" />
              {t('usersPage.actions.deactivate')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setActionTarget({ user, kind: 'reactivate' })}>
              <Power className="text-muted-foreground" aria-hidden="true" />
              {t('usersPage.actions.reactivate')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={isSelf} onClick={() => setDeletingUser(user)}>
            <Trash2 aria-hidden="true" />
            {t('usersPage.actions.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const dialogs = (
    <>
      <EditUserDialog user={editingUser} open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)} />
      <ResetPasswordDialog
        user={resettingUser}
        open={!!resettingUser}
        onOpenChange={(open) => !open && setResettingUser(null)}
      />
      <DeleteUserDialog user={deletingUser} open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)} />
      <UserActionDialog
        user={actionTarget?.user ?? null}
        kind={actionTarget?.kind ?? null}
        open={!!actionTarget}
        onOpenChange={(open) => !open && setActionTarget(null)}
      />
    </>
  )

  return { renderMenu, dialogs }
}
