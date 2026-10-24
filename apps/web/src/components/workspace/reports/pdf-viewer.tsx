import '@/lib/promise-with-resolvers'
import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

// The live preview of a report PDF (docs/reports_planing.md §9, D18):
// pdf.js draws each page into a canvas, so the toolbar around it is the
// app's own and looks the same in every browser. Loaded lazily — only a
// shown report pays for pdf.js. The legacy build, for every browser: the
// standard one fails on browsers without the newest features
// (Map.getOrInsertComputed, Math.sumPrecise, URL.parse …) — a white screen
// before the error boundary — and the legacy one fills those in, only
// 15 ms (computer) to 0.15 s (phone on 4G) slower to first open. It still
// needs Promise.withResolvers (Safari 17.4, Chrome 119), so we fill that
// in here and in the worker, which starts from our own file for it. One
// worker for the tab: pdf.js reuses a given port and never ends it.
GlobalWorkerOptions.workerPort = new Worker(new URL('../../../lib/report-pdf/pdf-preview.worker.ts', import.meta.url), {
  type: 'module',
})
// pdf.js refuses a new document on that worker while the last one is
// still being destroyed (EN → عربي in a hurry), so the next waits for it.
let destroying: Promise<void> = Promise.resolve()

/** Pages redraw sharp this long after the zoom stops moving (a pinch
 * sends dozens of zooms); until then the last drawing is stretched. */
const REDRAW_AFTER_MS = 150

export interface PdfViewerProps {
  blob: Blob
  zoom: number
  onPageCount: (pages: number) => void
  onVisiblePage: (page: number) => void
}

export default function PdfViewer({ blob, zoom, onPageCount, onVisiblePage }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [drawZoom, setDrawZoom] = useState(zoom)

  useEffect(() => {
    const timer = setTimeout(() => setDrawZoom(zoom), REDRAW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [zoom])

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof getDocument> | null = null
    void Promise.all([blob.arrayBuffer(), destroying]).then(([data]) => {
      if (cancelled) return
      task = getDocument({ data })
      return task.promise.then((pdf) => {
        if (cancelled) return
        setDoc(pdf)
        onPageCount(pdf.numPages)
      })
    })
    return () => {
      cancelled = true
      // Destroying the loading task frees the document; the worker stays.
      if (task) destroying = task.destroy().catch(() => undefined)
    }
    // onPageCount is a setter from the parent; only a new file reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob])

  if (!doc) return null
  return (
    // As wide as the widest page (never narrower than the view), so a page
    // zoomed past the view scrolls on both sides instead of clipping left.
    <div className="flex w-fit min-w-full flex-col items-center gap-5 px-6 py-6">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPage key={i} doc={doc} pageNumber={i + 1} zoom={zoom} drawZoom={drawZoom} onVisible={onVisiblePage} />
      ))}
    </div>
  )
}

function PdfPage({
  doc,
  pageNumber,
  zoom,
  drawZoom,
  onVisible,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  /** The size shown, at once (pinch zoom). */
  zoom: number
  /** The size the canvas is drawn at, once the zoom settles. */
  drawZoom: number
  onVisible: (page: number) => void
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The page at zoom 1, CSS px; A4 until the page reports its real size.
  const [base, setBase] = useState({ width: 794, height: 1123 })
  const size = { width: base.width * zoom, height: base.height * zoom }

  useEffect(() => {
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    let cancelled = false
    void doc.getPage(pageNumber).then((page) => {
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      // pdf.js units are points; 96/72 makes zoom 1 the page's CSS size.
      const viewport = page.getViewport({ scale: drawZoom * (96 / 72) })
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      setBase({ width: viewport.width / drawZoom, height: viewport.height / drawZoom })
      task = page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      })
      task.promise.catch(() => undefined)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber, drawZoom])

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onVisible(pageNumber)
      },
      { threshold: 0.5 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [pageNumber, onVisible])

  return (
    // White on purpose: the page is paper, the document itself, like the
    // fixed window material colours — only the chrome around it themes.
    <div ref={wrapperRef} className="shrink-0 bg-white shadow-lg ring-1 ring-black/5" style={size}>
      <canvas ref={canvasRef} style={size} aria-label={`Page ${pageNumber}`} />
    </div>
  )
}
