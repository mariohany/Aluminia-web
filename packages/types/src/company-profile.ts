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

// `.nullable().optional()` with no transform, like clients.ts: a
// transform gives the schema a different input type than output type,
// which breaks `useForm`. An empty input becomes null at the form layer
// (`optionalTextField`); the API then reads null as "clear it" and a
// missing key as "leave it alone".
const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional()

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
    email: z.email().max(COMPANY_PROFILE_LIMITS.email).nullable().optional(),
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

/** What a company profile must hold before anything prints
 * (docs/subscriptions_planing.md B23): both printed names, tax ID,
 * commercial register, and a phone or an email. The logo is optional. */
export const REQUIRED_PROFILE_FIELDS = [
  'enName',
  'arName',
  'taxId',
  'commercialRegister',
  'phoneOrEmail',
] as const
export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number]

type ProfileFacts = Pick<
  CompanyProfile,
  'enName' | 'arName' | 'taxId' | 'commercialRegister' | 'phone' | 'email'
>

const filled = (value: string | null | undefined) => !!value?.trim()

/** The required fields still empty, in form order. */
export function missingProfileFields(profile: ProfileFacts): RequiredProfileField[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) =>
    field === 'phoneOrEmail'
      ? !filled(profile.phone) && !filled(profile.email)
      : !filled(profile[field]),
  )
}

export function isProfileComplete(profile: ProfileFacts): boolean {
  return missingProfileFields(profile).length === 0
}
