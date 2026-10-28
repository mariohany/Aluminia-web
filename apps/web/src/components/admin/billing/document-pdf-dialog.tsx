import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, LoaderCircle, Printer } from 'lucide-react'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { billingPdfFileName, useBillingPdf } from '@/lib/billing-pdf'
import { canPrintPdf, downloadPdf, printPdf } from '@/lib/pdf-file'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const PdfViewer = lazy(() => import('@/components/workspace/reports/pdf-viewer'))

/** A quotation's or invoice's PDF, drawn in the browser, with Download and
 * Print (docs/subscriptions_planing.md §5). */
export function DocumentPdfDialog({
  document,
  onOpenChange,
}: {
  document: BillingDocumentSummary | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const { pdf, isError, retry } = useBillingPdf(document)
  const [, setPages] = useState(0)

  return (
    <Dialog open={document !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90svh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{document?.number}</DialogTitle>
          <DialogDescription>{document && t(`documents.kind.${document.kind}`)}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" disabled={!pdf} onClick={() => pdf && document && downloadPdf(pdf, billingPdfFileName(document))}>
            <Download aria-hidden="true" />
            {t('documents.pdf.download')}
          </Button>
          {canPrintPdf() && (
            <Button
              size="sm"
              variant="outline"
              disabled={!pdf}
              onClick={() => {
                if (!pdf) return
                try {
                  printPdf(pdf)
                } catch {
                  toast.error(t('documents.pdf.printError'))
                }
              }}
            >
              <Printer aria-hidden="true" />
              {t('documents.pdf.print')}
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg" style={{ backgroundColor: 'var(--board)' }}>
          {pdf ? (
            <Suspense fallback={null}>
              <PdfViewer blob={pdf} zoom={0.8} onPageCount={setPages} onVisiblePage={() => undefined} />
            </Suspense>
          ) : isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-destructive">{t('documents.pdf.error')}</p>
              <Button variant="outline" size="sm" onClick={retry}>
                {t('documents.pdf.retry')}
              </Button>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {t('documents.pdf.drawing')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
