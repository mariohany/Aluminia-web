import { lazy, Suspense, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  CircleCheck,
  Download,
  LoaderCircle,
  Printer,
  RefreshCw,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { ReportLanguage, type ReportStatus } from '@repo/types/reports'
import { Button } from '@/components/ui/button'
import { downloadPdf, printPdf } from '@/lib/pdf-file'
import {
  useBarOptimiserPdfQuery,
  useBarOptimiserStatusQuery,
  useCuttingSettingsQuery,
  useGenerateBarOptimiserMutation,
} from '@/lib/reports-queries'
import { cn } from '@/lib/utils'
import { CuttingSettingsPopover } from './cutting-settings-popover'
import { ReportProgressCard } from './report-progress-card'

const PdfViewer = lazy(() => import('./pdf-viewer'))

const ZOOMS = [0.5, 0.6, 0.7, 0.85, 1, 1.25, 1.5]
const DEFAULT_ZOOM = 0.85

/**
 * The bar optimiser report (docs/reports_planing.md §9, D18): the
 * settings line and status above, a floating toolbar (zoom, page,
 * EN/عربي, regenerate, print, download), and the PDF itself, drawn by
 * pdf.js. Generating runs in the background (D22): the progress card
 * shows over the previous PDF, which stays visible, dimmed.
 */
export function BarOptimiserView({
  projectId,
  projectName,
  clientName,
}: {
  projectId: string
  projectName: string
  clientName: string
}) {
  const { t, i18n } = useTranslation('reports')
  const appLanguage = i18n.resolvedLanguage === 'ar' ? ReportLanguage.AR : ReportLanguage.EN
  const [lang, setLang] = useState<ReportLanguage>(appLanguage)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)

  const statusQuery = useBarOptimiserStatusQuery(projectId, lang)
  const settingsQuery = useCuttingSettingsQuery()
  const generate = useGenerateBarOptimiserMutation(projectId, lang)
  const status = statusQuery.data
  const running = status?.job?.state === 'running'
  const pdfQuery = useBarOptimiserPdfQuery(projectId, lang, status?.generatedAt, !!status?.hasPdf)
  const pdf = pdfQuery.data

  const startGenerate = useCallback(() => {
    generate.mutate(undefined, { onError: () => toast.error(t('errors.generate')) })
  }, [generate, t])

  const onVisiblePage = useCallback((n: number) => setPage(n), [])
  const fileName = `${slug(projectName)}-bar-optimiser-${lang}.pdf`
  const zoomIndex = ZOOMS.indexOf(zoom)
  const settings = settingsQuery.data

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 px-5 pt-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-xs text-muted-foreground">
              {clientName} › {projectName}
            </span>
            <h1 className="text-base font-semibold">{t('kinds.barOptimiser.name')}</h1>
            {settings && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span dir="auto">
                  {t('settingsLine', {
                    lengths: settings.stockLengthsMm.join(' · '),
                    kerf: settings.kerfMm,
                    trim: settings.endTrimMm,
                  })}
                </span>
                <CuttingSettingsPopover settings={settings} onSaved={startGenerate} />
              </div>
            )}
          </div>
          {status && <StatusChip status={status} />}
        </div>

        {/* The floating toolbar (mock-up rep-chosen). */}
        <div className="flex flex-wrap items-center justify-center gap-1 self-center rounded-xl border border-border bg-card p-1 shadow-md">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('toolbar.zoomOut')}
            disabled={zoomIndex <= 0 || !pdf}
            onClick={() => setZoom(ZOOMS[Math.max(zoomIndex - 1, 0)] ?? DEFAULT_ZOOM)}
          >
            <ZoomOut className="size-4" aria-hidden="true" />
          </Button>
          <span className="w-11 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('toolbar.zoomIn')}
            disabled={zoomIndex >= ZOOMS.length - 1 || !pdf}
            onClick={() => setZoom(ZOOMS[Math.min(zoomIndex + 1, ZOOMS.length - 1)] ?? DEFAULT_ZOOM)}
          >
            <ZoomIn className="size-4" aria-hidden="true" />
          </Button>
          <Divider />
          <span className="px-1.5 font-mono text-xs text-muted-foreground" dir="ltr">
            {pdf && pageCount ? t('toolbar.page', { page, total: pageCount }) : '—'}
          </span>
          <Divider />
          <div role="group" aria-label={t('toolbar.language')} className="flex gap-0.5 rounded-lg border border-border p-0.5">
            {[ReportLanguage.EN, ReportLanguage.AR].map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={lang === option}
                onClick={() => {
                  setLang(option)
                  setPage(1)
                  setPageCount(0)
                }}
                className={cn(
                  'h-6.5 rounded-md px-2.5 text-xs',
                  lang === option ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option === ReportLanguage.EN ? 'EN' : 'عربي'}
              </button>
            ))}
          </div>
          <Button
            variant={status?.state === 'stale' && !running ? 'default' : 'ghost'}
            size="sm"
            className="h-8"
            disabled={!status || running || generate.isPending}
            onClick={startGenerate}
          >
            <RefreshCw className={cn('size-4', (running || generate.isPending) && 'animate-spin')} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{t('toolbar.regenerate')}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!pdf}
            onClick={() => {
              if (!pdf) return
              try {
                printPdf(pdf)
              } catch {
                toast.error(t('errors.print'))
              }
            }}
          >
            <Printer className="size-4" aria-hidden="true" />
            {t('toolbar.print')}
          </Button>
          <Button size="sm" className="h-8" disabled={!pdf} onClick={() => pdf && downloadPdf(pdf, fileName)}>
            <Download className="size-4" aria-hidden="true" />
            {t('toolbar.download')}
          </Button>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-auto"
        style={{ backgroundColor: 'var(--board)' }}
      >
        {statusQuery.isError ? (
          <Centered>
            <p className="text-sm text-destructive">{t('errors.status')}</p>
          </Centered>
        ) : !status ? (
          <Centered>
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </Centered>
        ) : (
          <>
            {pdf ? (
              <div className={cn('transition-opacity', (running || status.state === 'stale') && 'opacity-50')}>
                <Suspense fallback={null}>
                  <PdfViewer blob={pdf} zoom={zoom} onPageCount={setPageCount} onVisiblePage={onVisiblePage} />
                </Suspense>
              </div>
            ) : status.hasPdf && pdfQuery.isError ? (
              <Centered>
                <p className="text-sm text-destructive">{t('errors.pdf')}</p>
              </Centered>
            ) : status.state === 'none' && !running ? (
              <Centered>
                <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
                  <p className="text-sm font-semibold">{t('none.title')}</p>
                  <p className="text-[13px] text-muted-foreground">{t('none.body')}</p>
                  <Button onClick={startGenerate} disabled={generate.isPending}>
                    {t('none.generate')}
                  </Button>
                </div>
              </Centered>
            ) : null}

            {running && status.job && (
              <div className="absolute inset-x-0 top-6 flex justify-center">
                <ReportProgressCard groups={status.job.groups} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: ReportStatus }) {
  const { t, i18n } = useTranslation('reports')
  const base = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium'

  if (status.job?.state === 'running') {
    return (
      <span className={cn(base, 'bg-muted text-muted-foreground')}>
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        {t('status.running')}
      </span>
    )
  }
  if (status.job?.state === 'failed') {
    return (
      <span className={cn(base, 'bg-destructive/10 text-destructive')}>
        <TriangleAlert className="size-3.5" aria-hidden="true" />
        {status.job.error === 'interrupted' ? t('status.interrupted') : t('status.failed')}
      </span>
    )
  }
  if (status.state === 'fresh' && status.generatedAt) {
    const date = new Intl.DateTimeFormat(i18n.resolvedLanguage === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(status.generatedAt))
    return (
      <span className={cn(base, 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400')}>
        <CircleCheck className="size-3.5" aria-hidden="true" />
        {t('status.fresh', { date })}
      </span>
    )
  }
  if (status.state === 'stale') {
    return (
      <span className={cn(base, 'bg-amber-500/12 text-amber-700 dark:text-amber-500')}>
        <RefreshCw className="size-3.5" aria-hidden="true" />
        {status.changedWindows > 0
          ? t('status.staleWindows', { count: status.changedWindows })
          : t('status.stale')}
      </span>
    )
  }
  return <span className={cn(base, 'bg-muted text-muted-foreground')}>{t('status.none')}</span>
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-60 items-center justify-center p-6">{children}</div>
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  )
}
