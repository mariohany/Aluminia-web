import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Banknote, Download } from 'lucide-react'
import {
  DOCUMENT_VIEW_STATUSES,
  type BillingDocumentSummary,
  type DocumentStatus,
} from '@repo/types/billing-documents'
import type { BillingDocumentKind } from '@repo/types/billing-profile'
import { apiErrorMessage } from '@/lib/api-client'
import { exportTransactionsCsv, type TransactionsFilters } from '@/lib/billing-api'
import { useTransactionsInfiniteQuery, useTransactionsSummaryQuery } from '@/lib/billing-queries'
import { useCompaniesQuery } from '@/lib/companies-queries'
import { downloadPdf } from '@/lib/pdf-file'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchInput } from '@/components/ui/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VirtualizedLogTable, type LogColumn } from '@/components/admin/admin-logs/virtualized-log-table'
import { DocumentStatusPill } from '@/components/admin/billing/document-status'
import { MarkPaidDialog } from '@/components/admin/billing/mark-paid-dialog'

const KINDS = ['all', 'invoice', 'quotation'] as const

/**
 * Admin › Billing › Transactions (docs/subscriptions_planing.md B21, board
 * `bill-tx`): every quotation and invoice of every company, newest first,
 * in a recycled list that loads more as it scrolls (like Logs). KPIs in
 * EGP at each document's frozen rate; filters; CSV of what's filtered.
 */
export function TransactionsPage() {
  const { t, i18n } = useTranslation('admin')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all')
  const [status, setStatus] = useState<DocumentStatus | 'all'>('all')
  const [companyId, setCompanyId] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim())
  const [paying, setPaying] = useState<BillingDocumentSummary | null>(null)
  const [exporting, setExporting] = useState(false)

  const filters: TransactionsFilters = {
    kind: kind === 'all' ? undefined : (kind as BillingDocumentKind),
    status: status === 'all' ? undefined : status,
    companyId: companyId === 'all' ? undefined : companyId,
    from: from || undefined,
    to: to || undefined,
    search: debouncedSearch || undefined,
  }
  const filtered = kind !== 'all' || status !== 'all' || companyId !== 'all' || !!from || !!to || !!search

  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useTransactionsInfiniteQuery(filters)
  const summary = useTransactionsSummaryQuery()
  const { data: companies } = useCompaniesQuery()
  const rows = data?.pages.flatMap((p) => p.items) ?? []

  const egp = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }),
    [i18n.language],
  )
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }), [i18n.language])
  const money = (doc: BillingDocumentSummary) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: doc.currency }).format(doc.totals.total)

  async function exportCsv() {
    setExporting(true)
    try {
      downloadPdf(await exportTransactionsCsv(filters), 'transactions.csv')
    } catch (err) {
      toast.error(apiErrorMessage(err, t('transactions.exportError')))
    } finally {
      setExporting(false)
    }
  }

  const columns: LogColumn<BillingDocumentSummary>[] = [
    {
      key: 'number',
      header: t('documents.number'),
      width: '1.3fr',
      cell: (d) => (
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[13px] text-foreground">{d.number}</span>
          <span className="text-xs text-muted-foreground">{t(`documents.kind.${d.kind}`)}</span>
        </span>
      ),
    },
    {
      key: 'company',
      header: t('transactions.company'),
      width: '1.6fr',
      cell: (d) => (
        <Link to={`/app/companies/${d.company.id}?tab=billing`} className="font-medium text-foreground hover:underline">
          {i18n.language === 'ar' && d.company.nameAr ? d.company.nameAr : d.company.name}
        </Link>
      ),
    },
    { key: 'status', header: t('documents.status.label'), width: '0.9fr', cell: (d) => <DocumentStatusPill status={d.status} /> },
    {
      key: 'total',
      header: t('documents.total'),
      width: '1fr',
      className: 'text-end font-mono text-[13px]',
      cell: (d) => money(d),
    },
    {
      key: 'created',
      header: t('documents.created'),
      width: '1fr',
      className: 'text-muted-foreground',
      cell: (d) => dateFormatter.format(new Date(d.createdAt)),
    },
    {
      key: 'actions',
      header: '',
      width: '7.5rem',
      cell: (d) =>
        d.kind === 'quotation' && (d.status === 'draft' || d.status === 'sent') ? (
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setPaying(d)}>
            <Banknote aria-hidden="true" />
            {t('documents.actions.markPaid')}
          </Button>
        ) : null,
    },
  ]

  const kpis = [
    { label: t('transactions.kpis.month'), value: summary.data && egp.format(summary.data.receivedThisMonthEgp) },
    { label: t('transactions.kpis.year'), value: summary.data && egp.format(summary.data.receivedThisYearEgp) },
    {
      label: t('transactions.kpis.unpaid'),
      value: summary.data && egp.format(summary.data.unpaidEgp),
      caption: summary.data && t('transactions.kpis.unpaidCount', { count: summary.data.unpaidCount }),
    },
    { label: t('transactions.kpis.drafts'), value: summary.data && String(summary.data.draftCount) },
  ]

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{t('transactions.title')}</h1>
          <p className="text-[13px] text-muted-foreground">{t('transactions.subtitle')}</p>
        </div>
        <Button variant="outline" disabled={exporting} onClick={() => void exportCsv()}>
          <Download aria-hidden="true" />
          {t('transactions.export')}
        </Button>
      </div>

      <section className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('transactions.kpis.label')}>
        {kpis.map((kpi) => (
          <div key={kpi.label} className="flex min-w-0 flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
            <span className="text-xs text-muted-foreground">{kpi.label}</span>
            <span className="truncate font-mono text-lg font-semibold text-foreground">{kpi.value ?? '—'}</span>
            {kpi.caption && <span className="text-xs text-muted-foreground">{kpi.caption}</span>}
          </div>
        ))}
      </section>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t('transactions.kind')} className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                'h-7 rounded-md px-3 text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                kind === k ? 'bg-card font-semibold text-foreground shadow-xs' : 'font-medium text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`transactions.kinds.${k}`)}
            </button>
          ))}
        </div>
        <Select value={status} onValueChange={(value) => value && setStatus(value as DocumentStatus | 'all')}>
          <SelectTrigger className="w-36" aria-label={t('documents.status.label')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('transactions.allStatuses')}</SelectItem>
            {DOCUMENT_VIEW_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`documents.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={companyId} onValueChange={(value) => value && setCompanyId(value)}>
          <SelectTrigger className="w-52" aria-label={t('transactions.company')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('transactions.allCompanies')}</SelectItem>
            {(companies ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label htmlFor="tx-from" className="text-xs text-muted-foreground">
            {t('logsPage.filters.from')}
          </Label>
          <Input id="tx-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-36" />
          <Label htmlFor="tx-to" className="text-xs text-muted-foreground">
            {t('logsPage.filters.to')}
          </Label>
          <Input id="tx-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-36" />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKind('all')
              setStatus('all')
              setCompanyId('all')
              setFrom('')
              setTo('')
              setSearch('')
            }}
          >
            {t('logsPage.filters.clearAll')}
          </Button>
        )}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('transactions.search')}
          aria-label={t('transactions.search')}
          className="ms-auto max-w-64"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {isLoading ? (
          <div className="m-4 h-24 animate-pulse rounded bg-muted" />
        ) : isError ? (
          <p className="p-4 text-sm text-destructive">{t('transactions.error')}</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{filtered ? t('logsPage.noMatches') : t('transactions.empty')}</p>
        ) : (
          <VirtualizedLogTable
            columns={columns}
            rows={rows}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={() => void fetchNextPage()}
            loadingMoreLabel={t('logsPage.loadingMore')}
          />
        )}
      </div>

      <MarkPaidDialog document={paying} onOpenChange={(open) => !open && setPaying(null)} />
    </div>
  )
}
