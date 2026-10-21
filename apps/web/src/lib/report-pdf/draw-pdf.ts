import type { BarOptimiserPdfInput } from '@repo/report-pdf/bar-optimiser-document'
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

export function drawBarOptimiserPdf(input: BarOptimiserPdfInput): Promise<Blob> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    const request: DrawRequest = { id, input }
    getWorker().postMessage(request)
  })
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
