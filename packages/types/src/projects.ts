import { z } from 'zod'
import { scopedRefSchema } from '@repo/types/company-lookups'

// Same bilingual rule as clients.ts: English required, Arabic optional
// with a render-time fallback. `.nullable().optional()` with no
// transform — see the comment there for why a transform would break
// `useForm` typing, and why empty inputs are converted at the form
// layer instead.
const optionalName = z.string().trim().min(1).max(255).nullable().optional()
const optionalText = z.string().trim().min(1).nullable().optional()

// Fixed short list rather than free text — this phase doesn't need
// currency formatting/validation beyond "one of the currencies this
// product actually quotes in".
export const PROJECT_CURRENCIES = ['EGP', 'USD', 'EUR', 'SAR', 'AED'] as const
export type ProjectCurrency = (typeof PROJECT_CURRENCIES)[number]

const optionalPercent = z.number().min(0).max(100).nullable().optional()

// A project's optional defaults for the window designer — Systems
// (brand → catalogue) and Commercial (currency, VAT, discount). Every
// field independently optional: "not set" is a first-class state, not
// an error. See docs/project_preferences_planing.md.
//
// `defaultSystemBrand`/`defaultSystemCatalog` are `ScopedRef` strings at
// the wire boundary — reused unchanged from company-lookups.ts — even
// though the tenant table stores each as a nullable platform/company
// uuid pair; that split is a storage detail the API layer converts,
// not something the shared contract needs to know about.
//
// No existence check against either schema here, deliberately: a ref
// that no longer resolves is surfaced on read as "unavailable", not
// rejected at write time (same posture the Data page already takes for
// a dangling company-lookups reference).
export const projectPreferencesSchema = z.object({
  defaultSystemBrand: scopedRefSchema.nullable().optional(),
  defaultSystemCatalog: scopedRefSchema.nullable().optional(),
  currency: z.enum(PROJECT_CURRENCIES).nullable().optional(),
  vatRate: optionalPercent,
  discountRate: optionalPercent,
})
export type ProjectPreferencesInput = z.infer<typeof projectPreferencesSchema>

// `clientId` is create-only, deliberately. A project cannot be moved to
// a different client once it exists — it is absent from
// `updateProjectSchema` below, not merely ignored there, so the API has
// no path to reassign one. Window designs and paperwork will hang off a
// project in later phases and would silently travel with it.
export const createProjectSchema = z.object({
  clientId: z.uuid(),
  enName: z.string().trim().min(1).max(255),
  arName: optionalName,
  enAddress: optionalText,
  arAddress: optionalText,
  notes: optionalText,
  phone: z.string().trim().min(1).max(50).nullable().optional(),
  email: z.email().max(255).nullable().optional(),
  ...projectPreferencesSchema.shape,
})
export type CreateProjectInput = z.infer<typeof createProjectSchema>

// Every field optional so the same endpoint handles a rename, an
// address correction, a contact change, or a preferences edit — the
// same PATCH serves all four, including "step 2 alone" from the
// project's context menu / properties panel. No `clientId` — see above.
export const updateProjectSchema = z.object({
  enName: z.string().trim().min(1).max(255).optional(),
  arName: optionalName,
  enAddress: optionalText,
  arAddress: optionalText,
  notes: optionalText,
  phone: z.string().trim().min(1).max(50).nullable().optional(),
  email: z.email().max(255).nullable().optional(),
  ...projectPreferencesSchema.shape,
})
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>

/**
 * What the navigation tree needs per project, and nothing more — the
 * tree renders a name and that's it.
 */
export interface ProjectSummary {
  id: string
  enName: string
  arName: string | null
}

/**
 * `GET /projects/:id` — everything the properties panel shows.
 *
 * `createdByUserId` is a bare id with no name attached: `users` lives in
 * the control-plane schema and tenant tables never reach across into it
 * (see docs/projects_planing.md section 1). Resolving it to a display
 * name is an API-layer job, and nothing asks for one yet.
 */
export interface ProjectDetail extends ProjectSummary {
  clientId: string
  enAddress: string | null
  arAddress: string | null
  notes: string | null
  phone: string | null
  email: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
  // Preferences — always present, always possibly null. Raw `ScopedRef`
  // strings, not resolved display names: the caller already holds the
  // full merged catalogue (apps/web/src/lib/lookup-merge.ts) for every
  // screen that shows these, so resolving a name here would mean every
  // project read reaching into two schemas for a value the caller can
  // already derive for free.
  defaultSystemBrand: string | null
  defaultSystemCatalog: string | null
  currency: ProjectCurrency | null
  vatRate: number | null
  discountRate: number | null
}
