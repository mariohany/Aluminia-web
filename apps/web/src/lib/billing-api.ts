import type {
  BillingDocumentSummary,
  FxQuote,
  MarkPaidInput,
  QuotationInput,
  SendDocumentInput,
  TransactionsPage,
  TransactionsQuery,
  TransactionsSummary,
  VoidQuotationInput,
} from '@repo/types/billing-documents'
import type { BillingCurrency } from '@repo/types/subscriptions'
import { apiFetch } from '@/lib/api-client'

export type TransactionsFilters = Omit<TransactionsQuery, 'cursor' | 'limit'>

function filterParams(filters: TransactionsFilters): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params
}

export function getFxQuote(currency: BillingCurrency): Promise<FxQuote> {
  return apiFetch<FxQuote>(`/admin/billing/fx?currency=${currency}`)
}

export function listCompanyDocuments(companyId: string): Promise<BillingDocumentSummary[]> {
  return apiFetch<BillingDocumentSummary[]>(`/admin/companies/${companyId}/documents`)
}

export function createQuotation(companyId: string, input: QuotationInput): Promise<BillingDocumentSummary> {
  return apiFetch<BillingDocumentSummary>(`/admin/companies/${companyId}/quotations`, { method: 'POST', body: input })
}

export function updateQuotation(id: string, input: QuotationInput): Promise<BillingDocumentSummary> {
  return apiFetch<BillingDocumentSummary>(`/admin/billing/documents/${id}`, { method: 'PATCH', body: input })
}

export function voidQuotation(id: string, input: VoidQuotationInput): Promise<BillingDocumentSummary> {
  return apiFetch<BillingDocumentSummary>(`/admin/billing/documents/${id}/void`, { method: 'POST', body: input })
}

export function markPaid(id: string, input: MarkPaidInput): Promise<BillingDocumentSummary> {
  return apiFetch<BillingDocumentSummary>(`/admin/billing/documents/${id}/pay`, { method: 'POST', body: input })
}

export function listTransactions(
  filters: TransactionsFilters,
  cursor: string | null,
  limit: number,
): Promise<TransactionsPage> {
  const params = filterParams(filters)
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  return apiFetch<TransactionsPage>(`/admin/billing/transactions?${params.toString()}`)
}

export function getTransactionsSummary(): Promise<TransactionsSummary> {
  return apiFetch<TransactionsSummary>('/admin/billing/transactions/summary')
}

/** Fetched, not linked: the access token is a Bearer header. */
export function exportTransactionsCsv(filters: TransactionsFilters): Promise<Blob> {
  return apiFetch<Blob>(`/admin/billing/transactions.csv?${filterParams(filters).toString()}`, {
    responseType: 'blob',
  })
}

export function getSendDefaults(id: string): Promise<{ subject: string }> {
  return apiFetch<{ subject: string }>(`/admin/billing/documents/${id}/send-defaults`)
}

export function sendDocument(id: string, input: SendDocumentInput): Promise<BillingDocumentSummary> {
  return apiFetch<BillingDocumentSummary>(`/admin/billing/documents/${id}/send`, { method: 'POST', body: input })
}
