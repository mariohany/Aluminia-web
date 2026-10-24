import type { BarOptimiserPdfInput } from '@repo/report-pdf/bar-optimiser-document'

// What the page and the PDF-drawing worker say to each other.

/** A report to draw, or `warm`: load the fonts before the first one
 * (docs/report_speed_planing.md §3). */
export type DrawRequest = { id: number; input: BarOptimiserPdfInput } | { id: number; warm: true }

export type DrawReply = { id: number; ok: true; bytes: ArrayBuffer } | { id: number; ok: false; message: string }
