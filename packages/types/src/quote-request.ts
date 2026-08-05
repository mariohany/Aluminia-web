import { z } from 'zod'

/**
 * POST /leads/quote-requests (not yet implemented — see Stage E of
 * docs/landing_planing.md). `website` is a honeypot: real users never see
 * or fill it, so a non-empty value marks the submission as spam.
 */
export const quoteRequestSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  requesterName: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .min(6)
    .max(20)
    .regex(/^[0-9+()\-\s]+$/),
  website: z.string().max(0).optional().or(z.literal('')),
})

export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>

export interface QuoteRequestResponse {
  id: string
  receivedAt: string
}
