import type { QuoteRequestInput, QuoteRequestResponse } from '@repo/types/quote-request'
import { apiFetch } from '@/lib/api-client'

/**
 * Real as of Stage E. `skipAuthRetry` because this is an anonymous,
 * unauthenticated route — a 401 here is a real rejection, never a
 * "refresh and retry" situation the way an expired session would be.
 */
export function submitQuoteRequest(input: QuoteRequestInput): Promise<QuoteRequestResponse> {
  return apiFetch<QuoteRequestResponse>('/leads/quote-requests', {
    method: 'POST',
    body: input,
    skipAuthRetry: true,
  })
}
