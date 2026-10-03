import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowUpDown, MoreHorizontal } from 'lucide-react'
import { CompanyStatus, PLATFORM_COMPANY_LIMIT, type CompanyListItem } from '@repo/types/companies'
import { useCompaniesQuery } from '@/lib/companies-queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CreateCompanyDialog } from '@/components/admin/companies/create-company-dialog'
import { ArchiveReactivateDialog } from '@/components/admin/companies/archive-reactivate-dialog'
import { DeleteCompanyDialog } from '@/components/admin/companies/delete-company-dialog'
import { CompanyAvatar, CompanyStatusPill, NeutralPill } from '@/components/admin/companies/company-badges'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const columnHelper = createColumnHelper<typeof features, CompanyListItem>()

type StatusFilter = 'all' | CompanyStatus

/** Seats used out of the company's limit: amber from 80%, red when full. */
function SeatBar({ used, max, label }: { used: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(used / max, 1) : 0
  return (
    <span className="flex items-center gap-2.5">
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
        className="block h-1.5 w-20 overflow-hidden rounded-full bg-accent"
      >
        <span
          className={cn(
            'block h-full rounded-full',
            ratio >= 1 ? 'bg-destructive' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-primary',
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      <span className={cn('font-mono text-xs', ratio >= 1 ? 'font-medium text-destructive' : 'text-muted-foreground')} dir="ltr">
        {used}/{max}
      </span>
    </span>
  )
}

/**
 * The super admin's company list (docs/admin_redesign_planing.md §3,
 * option A): search + status buttons with counts + plan filter, then one
 * sortable table with seat bars, project counts and a row menu.
 */
export function CompaniesPage() {
  const { t, i18n } = useTranslation('admin')
  const navigate = useNavigate()
  const { data, isLoading, isError } = useCompaniesQuery()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [planFilter, setPlanFilter] = useState<string>('all')
  // Row-menu dialogs, opened from the ⋯ menu (same pattern as the Users page).
  const [archiveTarget, setArchiveTarget] = useState<CompanyListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CompanyListItem | null>(null)

  const companies = useMemo(() => data ?? [], [data])

  const plans = useMemo(() => {
    const unique = new Set(companies.map((company) => company.plan))
    return Array.from(unique).sort()
  }, [companies])

  const statusCounts = useMemo(
    () => ({
      all: companies.length,
      [CompanyStatus.ACTIVE]: companies.filter((c) => c.status === CompanyStatus.ACTIVE).length,
      [CompanyStatus.SUSPENDED]: companies.filter((c) => c.status === CompanyStatus.SUSPENDED).length,
    }),
    [companies],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return companies.filter((company) => {
      if (query && !company.name.toLowerCase().includes(query)) return false
      if (statusFilter !== 'all' && company.status !== statusFilter) return false
      if (planFilter !== 'all' && company.plan !== planFilter) return false
      return true
    })
  }, [companies, search, statusFilter, planFilter])

  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  )
  // Radix positions by physical side (no DirectionProvider): the menu
  // hangs off the row's end, which is the left edge in Arabic.
  const menuAlign = i18n.dir() === 'rtl' ? 'start' : 'end'

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('name', {
          header: t('companiesPage.table.name'),
          cell: (info) => (
            <span className="flex items-center gap-2.5">
              <CompanyAvatar name={info.getValue()} />
              <Link
                to={`/app/companies/${info.row.original.id}`}
                className="rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {info.getValue()}
              </Link>
            </span>
          ),
        }),
        columnHelper.accessor('status', {
          header: t('companiesPage.table.status'),
          cell: (info) => <CompanyStatusPill status={info.getValue()} />,
        }),
        columnHelper.accessor('plan', {
          header: t('companiesPage.table.plan'),
          cell: (info) => <NeutralPill>{info.getValue()}</NeutralPill>,
        }),
        columnHelper.display({
          id: 'seats',
          header: t('companiesPage.table.seats'),
          cell: (info) => {
            const company = info.row.original
            return (
              <SeatBar
                used={company.userCount}
                max={company.maxUsers}
                label={t('companiesPage.table.seatsOf', { name: company.name })}
              />
            )
          },
        }),
        columnHelper.display({
          id: 'projects',
          header: t('companiesPage.table.projects'),
          cell: (info) => {
            const count = info.row.original.projectCount
            return (
              <span className="font-mono text-xs text-foreground" dir="ltr">
                {count === null ? '—' : numberFormatter.format(count)}
              </span>
            )
          },
        }),
        columnHelper.accessor('createdAt', {
          header: t('companiesPage.table.createdAt'),
          cell: (info) => <span className="text-muted-foreground">{dateFormatter.format(new Date(info.getValue()))}</span>,
        }),
        columnHelper.display({
          id: 'actions',
          header: () => <span className="sr-only">{t('companiesPage.table.actions')}</span>,
          cell: (info) => {
            const company = info.row.original
            const active = company.status === CompanyStatus.ACTIVE
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t('companiesPage.rowMenu.label', { name: company.name })}>
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={menuAlign} className="w-auto min-w-44 whitespace-nowrap *:data-[slot=dropdown-menu-item]:gap-2.5 *:data-[slot=dropdown-menu-item]:px-2.5 *:data-[slot=dropdown-menu-item]:py-1.5">
                  <DropdownMenuItem onClick={() => void navigate(`/app/companies/${company.id}`)}>
                    {t('companiesPage.rowMenu.open')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setArchiveTarget(company)}>
                    {active ? t('companyDetail.actions.archive') : t('companyDetail.actions.reactivate')}
                  </DropdownMenuItem>
                  {/* Same rule as the company page: only an archived
                      company can be deleted permanently. */}
                  {!active && (
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(company)}>
                      {t('companyDetail.actions.delete')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          },
        }),
      ]),
    [t, dateFormatter, numberFormatter, navigate, menuAlign],
  )

  const table = useTable({
    features,
    columns,
    data: filtered,
    initialState: { sorting: [{ id: 'createdAt', desc: true }] },
  })

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: t('companiesPage.filters.all') },
    { value: CompanyStatus.ACTIVE, label: t('companiesPage.status.active') },
    { value: CompanyStatus.SUSPENDED, label: t('companiesPage.status.suspended') },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('companiesPage.title')}</h1>
          {data && (
            <p className="text-sm text-muted-foreground">
              {t('companiesPage.subtitle', {
                count: numberFormatter.format(companies.length),
                limit: numberFormatter.format(PLATFORM_COMPANY_LIMIT),
              })}
            </p>
          )}
        </div>
        <CreateCompanyDialog />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('companiesPage.search.placeholder')}
          className="max-w-xs"
        />
        <div role="group" aria-label={t('companiesPage.table.status')} className="flex items-center gap-1.5">
          {statusOptions.map(({ value, label }) => {
            const on = statusFilter === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  on
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-foreground hover:bg-accent',
                )}
              >
                {label}
                <span className="font-mono text-[11px] opacity-70">{numberFormatter.format(statusCounts[value])}</span>
              </button>
            )
          })}
        </div>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Select value={planFilter} onValueChange={setPlanFilter}>
          <SelectTrigger className="w-40" aria-label={t('companiesPage.table.plan')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('companiesPage.filters.allPlans')}</SelectItem>
            {plans.map((plan) => (
              <SelectItem key={plan} value={plan}>
                {plan}
              </SelectItem>
            ))}
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
                  {companies.length === 0 ? t('companiesPage.table.empty') : t('companiesPage.table.noResults')}
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

      {archiveTarget && (
        <ArchiveReactivateDialog
          company={archiveTarget}
          open
          onOpenChange={(next) => {
            if (!next) setArchiveTarget(null)
          }}
        />
      )}
      {deleteTarget && (
        <DeleteCompanyDialog
          company={deleteTarget}
          open
          onOpenChange={(next) => {
            if (!next) setDeleteTarget(null)
          }}
          onDeleted={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
