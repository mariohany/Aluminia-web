import type { BarOptimiserPdfInput } from '@repo/report-pdf/bar-optimiser-document'
import type { BillingPdfInput } from '@repo/report-pdf/billing-document'
import { reportError } from '@/lib/monitoring'
import type { DrawReply, DrawRequest } from './draw-messages'

// The page's side of the PDF-drawing worker (docs/browser_pdf_planing.md
// §5): one worker, created on the first report, drawing one PDF at a time
// in order.

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (pdf: Blob) => void; reject: (error: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./draw.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<DrawReply>) => {
    const reply = event.data
    const pending = waiting.get(reply.id)
    if (!pending) return
    waiting.delete(reply.id)
    if (reply.ok) pending.resolve(new Blob([reply.bytes], { type: 'application/pdf' }))
    else {
      const error = new Error(reply.message)
      reportError(error, { area: 'pdf-draw' })
      pending.reject(error)
    }
  }
  // The worker itself failed (didn't load, ran out of memory): fail every
  // waiting drawing and start a fresh worker next time.
  worker.onerror = (event) => {
    event.preventDefault()
    const error = new Error(event.message || 'The PDF worker stopped.')
    reportError(error, { area: 'pdf-draw', tags: { worker: 'crashed' } })
    for (const pending of waiting.values()) pending.reject(error)
    waiting.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function draw(request: DrawRequest): Promise<Blob> {
  return new Promise((resolve, reject) => {
    waiting.set(request.id, { resolve, reject })
    getWorker().postMessage(request)
  })
}

export function drawBarOptimiserPdf(input: BarOptimiserPdfInput): Promise<Blob> {
  return draw({ id: nextId++, input })
}

/** A quotation or invoice (docs/subscriptions_planing.md §5), drawn from
 * its snapshot by the same worker. */
export function drawBillingPdf(billing: BillingPdfInput): Promise<Blob> {
  return draw({ id: nextId++, billing })
}

let warmed = false

/** Starts the worker and loads the fonts, once per tab, so the first
 * report doesn't wait for them (docs/report_speed_planing.md §3, S4).
 * A failure only means the first report loads them itself. */
export function warmPdfWorker(): void {
  if (warmed) return
  warmed = true
  const id = nextId++
  waiting.set(id, { resolve: () => undefined, reject: () => undefined })
  const request: DrawRequest = { id, warm: true }
  getWorker().postMessage(request)
}

/** The logo as a data URI @react-pdf can embed: PNG and JPEG as they are,
 * anything else (WebP) converted to PNG first. */
export async function logoDataUri(blob: Blob): Promise<string> {
  const embeddable = blob.type === 'image/png' || blob.type === 'image/jpeg' ? blob : await toPng(blob)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the logo.'))
    reader.readAsDataURL(embeddable)
  })
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/png' })
}
