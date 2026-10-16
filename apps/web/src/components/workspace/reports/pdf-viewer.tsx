import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// The live preview of a report PDF (docs/reports_planing.md §9, D18):
// pdf.js draws each page into a canvas, so the toolbar around it is the
// app's own and looks the same in every browser. Loaded lazily — only a
// shown report pays for pdf.js.
GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfViewerProps {
  blob: Blob
  zoom: number
  onPageCount: (pages: number) => void
  onVisiblePage: (page: number) => void
}

export default function PdfViewer({ blob, zoom, onPageCount, onVisiblePage }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof getDocument> | null = null
    void blob.arrayBuffer().then((data) => {
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
      // Destroying the loading task frees the document and its worker.
      void task?.destroy()
    }
    // onPageCount is a setter from the parent; only a new file reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob])

  if (!doc) return null
  return (
    <div className="flex flex-col items-center gap-5 py-6">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPage key={i} doc={doc} pageNumber={i + 1} zoom={zoom} onVisible={onVisiblePage} />
      ))}
    </div>
  )
}

function PdfPage({
  doc,
  pageNumber,
  zoom,
  onVisible,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  zoom: number
  onVisible: (page: number) => void
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // A4 at this zoom until the page reports its real size.
  const [size, setSize] = useState({ width: 794 * zoom, height: 1123 * zoom })

  useEffect(() => {
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    let cancelled = false
    void doc.getPage(pageNumber).then((page) => {
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      // pdf.js units are points; 96/72 makes zoom 1 the page's CSS size.
      const viewport = page.getViewport({ scale: zoom * (96 / 72) })
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      setSize({ width: viewport.width, height: viewport.height })
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
  }, [doc, pageNumber, zoom])

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
