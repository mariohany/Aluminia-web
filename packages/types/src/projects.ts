import { z } from 'zod'

// Same bilingual rule as clients.ts: English required, Arabic optional
// with a render-time fallback. `.nullable().optional()` with no
// transform — see the comment there for why a transform would break
// `useForm` typing, and why empty inputs are converted at the form
// layer instead.
const optionalName = z.string().trim().min(1).max(255).nullable().optional()
const optionalText = z.string().trim().min(1).nullable().optional()

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
})
export type CreateProjectInput = z.infer<typeof createProjectSchema>

// Every field optional so the same endpoint handles a rename, an
// address correction, or a contact change. No `clientId` — see above.
export const updateProjectSchema = z.object({
  enName: z.string().trim().min(1).max(255).optional(),
  arName: optionalName,
  enAddress: optionalText,
  arAddress: optionalText,
  notes: optionalText,
  phone: z.string().trim().min(1).max(50).nullable().optional(),
  email: z.email().max(255).nullable().optional(),
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
}
