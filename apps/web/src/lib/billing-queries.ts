import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MarkPaidInput, QuotationInput } from '@repo/types/billing-documents'
import type { BillingCurrency } from '@repo/types/subscriptions'
import * as billingApi from '@/lib/billing-api'
import type { TransactionsFilters } from '@/lib/billing-api'

const billingKey = ['billing'] as const
const documentsKey = (companyId: string) => [...billingKey, 'documents', companyId] as const

const transactionsKey = [...billingKey, 'transactions'] as const

// Chunks of a virtualized list (like admin Logs), not pages.
const CHUNK_SIZE = 40

export function useFxQuoteQuery(currency: BillingCurrency, enabled: boolean) {
  return useQuery({
    queryKey: [...billingKey, 'fx', currency] as const,
    queryFn: () => billingApi.getFxQuote(currency),
    enabled: enabled && currency !== 'EGP',
  })
}

export function useCompanyDocumentsQuery(companyId: string) {
  return useQuery({ queryKey: documentsKey(companyId), queryFn: () => billingApi.listCompanyDocuments(companyId) })
}

export function useTransactionsInfiniteQuery(filters: TransactionsFilters) {
  return useInfiniteQuery({
    queryKey: [...transactionsKey, 'list', filters] as const,
    queryFn: ({ pageParam }) => billingApi.listTransactions(filters, pageParam, CHUNK_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
}

export function useTransactionsSummaryQuery() {
  return useQuery({ queryKey: [...transactionsKey, 'summary'] as const, queryFn: billingApi.getTransactionsSummary })
}

/** After any document change: the company's list, Transactions, and the
 * company itself (a payment renews it; the dashboard counts it). */
function useInvalidateBilling() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: billingKey })
    void queryClient.invalidateQueries({ queryKey: ['companies'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

export function useSaveQuotationMutation(companyId: string) {
  const invalidate = useInvalidateBilling()
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: QuotationInput }) =>
      id ? billingApi.updateQuotation(id, input) : billingApi.createQuotation(companyId, input),
    onSuccess: () => invalidate(),
  })
}

export function useVoidQuotationMutation() {
  const invalidate = useInvalidateBilling()
  return useMutation({
    mutationFn: (id: string) => billingApi.voidQuotation(id),
    onSuccess: () => invalidate(),
  })
}

export function useMarkPaidMutation() {
  const invalidate = useInvalidateBilling()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MarkPaidInput }) => billingApi.markPaid(id, input),
    onSuccess: () => invalidate(),
  })
}
