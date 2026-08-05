import type { QuoteRequestInput, QuoteRequestResponse } from '@repo/types/quote-request'

/**
 * The only place that knows the real endpoint doesn't exist yet (Stage E
 * of docs/landing_planing.md). Swapping this body for a real `fetch` is
 * the entire integration — no caller changes.
 */
export async function submitQuoteRequest(_input: QuoteRequestInput): Promise<QuoteRequestResponse> {
  await new Promise((resolve) => setTimeout(resolve, 600))
  return { id: 'mock-lead', receivedAt: new Date().toISOString() }
}
