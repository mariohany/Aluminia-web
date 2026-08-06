import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowUpDown, MoreHorizontal } from 'lucide-react'
import type { UserSummary } from '@repo/types/users'
import { useAuth } from '@/lib/auth-context'
import { useCompaniesQuery } from '@/lib/companies-queries'
import { useUsersQuery } from '@/lib/users-queries'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreateUserDialog } from '@/components/admin/users/create-user-dialog'
import { EditUserDialog } from '@/components/admin/users/edit-user-dialog'
import { ResetPasswordDialog } from '@/components/admin/users/reset-password-dialog'
import { DeleteUserDialog } from '@/components/admin/users/delete-user-dialog'
import { UserActionDialog, type UserActionKind } from '@/components/admin/users/user-action-dialog'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const columnHelper = createColumnHelper<typeof features, UserSummary>()

export function UsersPage() {
  const { t, i18n } = useTranslation('admin')
  const { user: currentUser } = useAuth()
  const { data, isLoading, isError } = useUsersQuery()
  const { data: companies } = useCompaniesQuery()

  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [editingUser, setEditingUser] = useState<UserSummary | null>(null)
  const [resettingUser, setResettingUser] = useState<UserSummary | null>(null)
  const [deletingUser, setDeletingUser] = useState<UserSummary | null>(null)
  const [actionTarget, setActionTarget] = useState<{ user: UserSummary; kind: UserActionKind } | null>(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data ?? []).filter((user) => {
      if (query && !user.email.toLowerCase().includes(query)) return false
      if (companyFilter !== 'all' && user.companyId !== companyFilter) return false
      if (roleFilter !== 'all' && user.role !== roleFilter) return false
      if (statusFilter !== 'all' && user.status !== statusFilter) return false
      return true
    })
  }, [data, search, companyFilter, roleFilter, statusFilter])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('email', {
          header: t('usersPage.table.email'),
          cell: (info) => <span className="font-medium text-foreground">{info.getValue()}</span>,
        }),
        columnHelper.accessor('role', {
          header: t('usersPage.table.role'),
          cell: (info) => t(`usersPage.role.${info.getValue()}`),
        }),
        columnHelper.accessor('companyName', {
          header: t('usersPage.table.company'),
          cell: (info) => info.getValue() ?? t('usersPage.table.noCompany'),
        }),
        columnHelper.accessor('status', {
          header: t('usersPage.table.status'),
          cell: (info) => (
            <Badge variant={info.getValue() === 'active' ? 'default' : 'outline'}>
              {t(`usersPage.status.${info.getValue()}`)}
            </Badge>
          ),
        }),
        columnHelper.display({
          id: 'lastActivity',
          header: t('usersPage.table.lastActivity'),
          cell: (info) => {
            const user = info.row.original
            if (user.online) {
              return <Badge variant="secondary">{t('usersPage.table.online')}</Badge>
            }
            return (
              <span className="text-muted-foreground">
                {user.lastActiveAt ? dateFormatter.format(new Date(user.lastActiveAt)) : t('usersPage.table.never')}
              </span>
            )
          },
        }),
        columnHelper.display({
          id: 'actions',
          header: t('usersPage.table.actions'),
          cell: (info) => {
            const user = info.row.original
            const isSelf = user.id === currentUser?.id
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditingUser(user)}>
                    {t('usersPage.actions.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setResettingUser(user)}>
                    {t('usersPage.actions.resetPassword')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActionTarget({ user, kind: 'end-session' })}>
                    {t('usersPage.actions.endSession')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {user.status === 'active' ? (
                    <DropdownMenuItem
                      disabled={isSelf}
                      onClick={() => setActionTarget({ user, kind: 'deactivate' })}
                    >
                      {t('usersPage.actions.deactivate')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => setActionTarget({ user, kind: 'reactivate' })}>
                      {t('usersPage.actions.reactivate')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={isSelf}
                    onClick={() => setDeletingUser(user)}
                  >
                    {t('usersPage.actions.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          },
        }),
      ]),
    [t, dateFormatter, currentUser?.id],
  )

  const table = useTable({
    features,
    columns,
    data: filtered,
    initialState: { sorting: [{ id: 'email', desc: false }] },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">{t('usersPage.title')}</h1>
        <CreateUserDialog />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('usersPage.search.placeholder')}
          className="max-w-xs"
        />
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('usersPage.filters.allCompanies')}</SelectItem>
            {(companies ?? []).map((company) => (
              <SelectItem key={company.id} value={company.id}>
                {company.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('usersPage.filters.allRoles')}</SelectItem>
            <SelectItem value="super_admin">{t('usersPage.role.super_admin')}</SelectItem>
            <SelectItem value="company_admin">{t('usersPage.role.company_admin')}</SelectItem>
            <SelectItem value="user">{t('usersPage.role.user')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('usersPage.filters.allStatuses')}</SelectItem>
            <SelectItem value="active">{t('usersPage.status.active')}</SelectItem>
            <SelectItem value="inactive">{t('usersPage.status.inactive')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="flex items-center gap-1 font-medium"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        <ArrowUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  {t('usersPage.table.empty')}
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-destructive">
                  {t('companyDetail.actions.error')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && table.getRowModel().rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  {(data ?? []).length === 0 ? t('usersPage.table.empty') : t('usersPage.table.noResults')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !isError &&
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <EditUserDialog user={editingUser} open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)} />
      <ResetPasswordDialog
        user={resettingUser}
        open={!!resettingUser}
        onOpenChange={(open) => !open && setResettingUser(null)}
      />
      <DeleteUserDialog
        user={deletingUser}
        open={!!deletingUser}
        onOpenChange={(open) => !open && setDeletingUser(null)}
      />
      <UserActionDialog
        user={actionTarget?.user ?? null}
        kind={actionTarget?.kind ?? null}
        open={!!actionTarget}
        onOpenChange={(open) => !open && setActionTarget(null)}
      />
    </div>
  )
}
