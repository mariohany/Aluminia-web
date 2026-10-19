import type { BarOptimiserPdfInput } from '@repo/report-pdf/bar-optimiser-document'

// What the page and the PDF-drawing worker say to each other.

export interface DrawRequest {
  id: number
  input: BarOptimiserPdfInput
}

export type DrawReply = { id: number; ok: true; bytes: ArrayBuffer } | { id: number; ok: false; message: string }
