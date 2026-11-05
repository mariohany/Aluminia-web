import { useQuery } from '@tanstack/react-query'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import * as filesApi from '@/lib/files-api'
import { drawBillingPdf, logoDataUri } from '@/lib/report-pdf/draw-pdf'

/**
 * A quotation's or invoice's PDF (docs/subscriptions_planing.md §5), drawn
 * in this browser from the document's snapshot, never stored (Q1: the
 * email step sends these bytes for the server to attach). Kept in memory
 * for the tab, keyed by everything it prints.
 */
export function useBillingPdf(document: BillingDocumentSummary | null) {
  const logoId = document?.seller.logoFileId ?? null
  const logo = useQuery({
    queryKey: ['files', logoId, 'data-uri'] as const,
    queryFn: async () => logoDataUri(await filesApi.getFileBlob(logoId!)),
    enabled: !!logoId,
    staleTime: Infinity,
    retry: false,
  })
  const logoReady = !logoId || logo.isSuccess || logo.isError
  const drawn = useQuery({
    queryKey: ['billing', 'pdf', JSON.stringify(document)] as const,
    queryFn: () => drawBillingPdf({ document: document!, logo: logo.data ?? null }),
    enabled: !!document && logoReady,
    staleTime: Infinity,
    retry: false,
  })
  return { pdf: drawn.data, isError: drawn.isError, retry: () => void drawn.refetch() }
}

export function billingPdfFileName(document: BillingDocumentSummary): string {
  return `${document.number}.pdf`
}

/** A drawn PDF as base64, the send endpoint's attachment (Q1). */
export async function pdfToBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the PDF.'))
    reader.readAsDataURL(blob)
  })
  return url.slice(url.indexOf(',') + 1)
}
