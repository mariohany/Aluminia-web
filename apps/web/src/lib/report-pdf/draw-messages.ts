import type { BarOptimiserPdfInput } from '@repo/report-pdf/bar-optimiser-document'
import type { BillingPdfInput } from '@repo/report-pdf/billing-document'

// What the page and the PDF-drawing worker say to each other.

/** A report to draw, a quotation / invoice (`billing`), or `warm`: load the
 * fonts before the first one (docs/report_speed_planing.md §3). */
export type DrawRequest =
  | { id: number; input: BarOptimiserPdfInput }
  | { id: number; billing: BillingPdfInput }
  | { id: number; warm: true }

export type DrawReply = { id: number; ok: true; bytes: ArrayBuffer } | { id: number; ok: false; message: string }
