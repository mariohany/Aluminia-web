import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowUpDown } from 'lucide-react'
import type { UserSummary } from '@repo/types/users'
import { useCompaniesQuery } from '@/lib/companies-queries'
import { useUsersQuery } from '@/lib/users-queries'
import { SearchInput } from '@/components/ui/search-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CreateUserDialog } from '@/components/admin/users/create-user-dialog'
import { useUserRowActions } from '@/components/admin/users/user-row-actions'
import { LastActivity, UserAvatar, UserRolePill } from '@/components/admin/users/user-badges'
import { StatusPill } from '@/components/admin/companies/company-badges'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const columnHelper = createColumnHelper<typeof features, UserSummary>()

export function UsersPage() {
  const { t, i18n } = useTranslation('admin')
  const { data, isLoading, isError } = useUsersQuery()
  const { data: companies } = useCompaniesQuery()

  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const { renderMenu, dialogs } = useUserRowActions()

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

  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('email', {
          header: t('usersPage.table.email'),
          cell: (info) => (
            <span className="flex items-center gap-2.5">
              <UserAvatar email={info.getValue()} />
              <span className="font-medium text-foreground">{info.getValue()}</span>
            </span>
          ),
        }),
        columnHelper.accessor('role', {
          header: t('usersPage.table.role'),
          cell: (info) => <UserRolePill role={info.getValue()} />,
        }),
        columnHelper.accessor('companyName', {
          header: t('usersPage.table.company'),
          cell: (info) => {
            const user = info.row.original
            if (!user.companyId) return <span className="text-muted-foreground">{t('usersPage.table.noCompany')}</span>
            return (
              <Link
                to={`/app/companies/${user.companyId}`}
                className="rounded-sm text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {info.getValue()}
              </Link>
            )
          },
        }),
        columnHelper.accessor('status', {
          header: t('usersPage.table.status'),
          cell: (info) => (
            <StatusPill active={info.getValue() === 'active'}>{t(`usersPage.status.${info.getValue()}`)}</StatusPill>
          ),
        }),
        columnHelper.display({
          id: 'lastActivity',
          header: t('usersPage.table.lastActivity'),
          cell: (info) => <LastActivity user={info.row.original} formatter={dateFormatter} />,
        }),
        columnHelper.display({
          id: 'actions',
          header: () => <span className="sr-only">{t('usersPage.table.actions')}</span>,
          cell: (info) => renderMenu(info.row.original),
        }),
      ]),
    [t, dateFormatter, renderMenu],
  )

  const table = useTable({
    features,
    columns,
    data: filtered,
    initialState: { sorting: [{ id: 'email', desc: false }] },
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('usersPage.title')}</h1>
          {data && (
            <p className="text-sm text-muted-foreground">
              {t('usersPage.subtitle', {
                count: data.length,
                online: numberFormatter.format(data.filter((user) => user.online).length),
              })}
            </p>
          )}
        </div>
        <CreateUserDialog />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
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

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-10 px-3 text-xs text-muted-foreground">
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                <TableCell colSpan={columns.length} className="h-24">
                  <div className="h-6 animate-pulse rounded bg-muted" />
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
                <TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">
                  {(data ?? []).length === 0 ? t('usersPage.table.empty') : t('usersPage.table.noResults')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !isError &&
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className="h-12 px-3">
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {dialogs}
    </div>
  )
}
