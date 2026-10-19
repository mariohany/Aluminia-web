/// <reference lib="webworker" />
import { barOptimiserPdfBytes } from '@repo/report-pdf/bar-optimiser-document'
import { registerFonts, type FontFile } from '@repo/report-pdf/fonts'
import arabicRegular from '@repo/report-pdf/fonts/IBMPlexSansArabic-Regular.woff?url'
import arabicSemiBold from '@repo/report-pdf/fonts/IBMPlexSansArabic-SemiBold.woff?url'
import arabicBold from '@repo/report-pdf/fonts/IBMPlexSansArabic-Bold.woff?url'
import sansRegular from '@repo/report-pdf/fonts/Geist-Regular.ttf?url'
import sansSemiBold from '@repo/report-pdf/fonts/Geist-SemiBold.ttf?url'
import sansBold from '@repo/report-pdf/fonts/Geist-Bold.ttf?url'
import monoRegular from '@repo/report-pdf/fonts/GeistMono-Regular.ttf?url'
import monoSemiBold from '@repo/report-pdf/fonts/GeistMono-SemiBold.ttf?url'
import monoBold from '@repo/report-pdf/fonts/GeistMono-Bold.ttf?url'
import type { DrawReply, DrawRequest } from './draw-messages'

// Draws a report PDF off the page (docs/browser_pdf_planing.md §5): the
// page stays responsive for the 1.5–2.5 s it takes. One worker for the
// tab, kept alive so the fonts are fetched and parsed once.

const FONT_URLS: Record<FontFile, string> = {
  'IBMPlexSansArabic-Regular.woff': arabicRegular,
  'IBMPlexSansArabic-SemiBold.woff': arabicSemiBold,
  'IBMPlexSansArabic-Bold.woff': arabicBold,
  'Geist-Regular.ttf': sansRegular,
  'Geist-SemiBold.ttf': sansSemiBold,
  'Geist-Bold.ttf': sansBold,
  'GeistMono-Regular.ttf': monoRegular,
  'GeistMono-SemiBold.ttf': monoSemiBold,
  'GeistMono-Bold.ttf': monoBold,
}
// Absolute: @react-pdf fetches the fonts from inside the worker.
registerFonts((file) => new URL(FONT_URLS[file], self.location.href).href)

self.onmessage = async (event: MessageEvent<DrawRequest>) => {
  const { id, input } = event.data
  try {
    const bytes = await barOptimiserPdfBytes(input)
    const reply: DrawReply = { id, ok: true, bytes }
    self.postMessage(reply, [bytes])
  } catch (error) {
    const reply: DrawReply = { id, ok: false, message: error instanceof Error ? error.message : String(error) }
    self.postMessage(reply)
  }
}
