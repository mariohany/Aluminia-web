import { z } from 'zod'

// Config › Company profile (docs/company_profile_planing.md): the
// company's letterhead — printed names, address, contacts, tax numbers
// and logo — printed on reports and, later, quotes. Not to be confused
// with aluminium profiles (`company-lookups`' system profiles).

/** Max lengths; the tenant migration's columns mirror these. */
export const COMPANY_PROFILE_LIMITS = {
  name: 255,
  address: 500,
  phone: 40,
  email: 255,
  website: 255,
  registration: 60,
} as const

/** Trimmed text; an empty string clears the field (null). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

/** PATCH /company/profile: any subset of the fields. `logoFileId` is an
 * id from `POST /files` (purpose `logo`); null removes the logo. */
export const updateCompanyProfileSchema = z
  .object({
    // The printed English name is the one field that can't be cleared.
    enName: z.string().trim().min(1).max(COMPANY_PROFILE_LIMITS.name).optional(),
    arName: optionalText(COMPANY_PROFILE_LIMITS.name),
    enAddress: optionalText(COMPANY_PROFILE_LIMITS.address),
    arAddress: optionalText(COMPANY_PROFILE_LIMITS.address),
    phone: optionalText(COMPANY_PROFILE_LIMITS.phone),
    email: z
      .union([z.literal(''), z.email().max(COMPANY_PROFILE_LIMITS.email)])
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    website: optionalText(COMPANY_PROFILE_LIMITS.website),
    taxId: optionalText(COMPANY_PROFILE_LIMITS.registration),
    commercialRegister: optionalText(COMPANY_PROFILE_LIMITS.registration),
    logoFileId: z.uuid().nullable().optional(),
  })
  .strict()
export type UpdateCompanyProfileInput = z.infer<typeof updateCompanyProfileSchema>

export interface CompanyProfile {
  enName: string
  arName: string | null
  enAddress: string | null
  arAddress: string | null
  phone: string | null
  email: string | null
  website: string | null
  taxId: string | null
  commercialRegister: string | null
  /** Shown with `GET /files/:id`. */
  logoFileId: string | null
  /** Null until the first save (then `enName` is the account name). */
  updatedAt: string | null
}
