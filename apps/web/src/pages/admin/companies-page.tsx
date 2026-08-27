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
import { CompanyStatus, type CompanySummary } from '@repo/types/companies'
import { useCompaniesQuery } from '@/lib/companies-queries'
import { Badge } from '@/components/ui/badge'
import { SearchInput } from '@/components/ui/search-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CreateCompanyDialog } from '@/components/admin/companies/create-company-dialog'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const columnHelper = createColumnHelper<typeof features, CompanySummary>()

export function CompaniesPage() {
  const { t, i18n } = useTranslation('admin')
  const { data, isLoading, isError } = useCompaniesQuery()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | CompanyStatus>('all')
  const [planFilter, setPlanFilter] = useState<string>('all')

  const plans = useMemo(() => {
    const unique = new Set((data ?? []).map((company) => company.plan))
    return Array.from(unique).sort()
  }, [data])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data ?? []).filter((company) => {
      if (query && !company.name.toLowerCase().includes(query)) return false
      if (statusFilter !== 'all' && company.status !== statusFilter) return false
      if (planFilter !== 'all' && company.plan !== planFilter) return false
      return true
    })
  }, [data, search, statusFilter, planFilter])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  )

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('name', {
          header: t('companiesPage.table.name'),
          cell: (info) => (
            <Link
              to={`/app/companies/${info.row.original.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {info.getValue()}
            </Link>
          ),
        }),
        columnHelper.accessor('status', {
          header: t('companiesPage.table.status'),
          cell: (info) => (
            <Badge variant={info.getValue() === CompanyStatus.ACTIVE ? 'default' : 'outline'}>
              {t(`companiesPage.status.${info.getValue()}`)}
            </Badge>
          ),
        }),
        columnHelper.accessor('plan', {
          header: t('companiesPage.table.plan'),
          cell: (info) => info.getValue(),
        }),
        columnHelper.display({
          id: 'seats',
          header: t('companiesPage.table.seats'),
          cell: (info) => {
            const company = info.row.original
            const atCap = company.userCount >= company.maxUsers
            return (
              <span className={atCap ? 'font-medium text-destructive' : undefined}>
                {company.userCount} / {company.maxUsers}
              </span>
            )
          },
        }),
        columnHelper.accessor('createdAt', {
          header: t('companiesPage.table.createdAt'),
          cell: (info) => dateFormatter.format(new Date(info.getValue())),
        }),
      ]),
    [t, dateFormatter],
  )

  const table = useTable({
    features,
    columns,
    data: filtered,
    initialState: { sorting: [{ id: 'createdAt', desc: true }] },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">{t('companiesPage.title')}</h1>
        <CreateCompanyDialog />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('companiesPage.search.placeholder')}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('companiesPage.filters.allStatuses')}</SelectItem>
            <SelectItem value={CompanyStatus.ACTIVE}>{t('companiesPage.status.active')}</SelectItem>
            <SelectItem value={CompanyStatus.SUSPENDED}>{t('companiesPage.status.suspended')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={planFilter} onValueChange={setPlanFilter}>
          <SelectTrigger className="w-40">
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
                  {t('companiesPage.table.empty')}
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
                  {(data ?? []).length === 0
                    ? t('companiesPage.table.empty')
                    : t('companiesPage.table.noResults')}
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
    </div>
  )
}
