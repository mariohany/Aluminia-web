import { z } from 'zod'
import type { ProjectSummary } from './projects'

// Bilingual content, not a bilingual UI: English is required, Arabic is
// optional, and the interface falls back to English when Arabic is
// blank. See docs/projects_planing.md's bilingual rule for why this
// isn't "both required".
//
// `.nullable().optional()` with no transform, deliberately: a Zod
// transform gives the schema a different input type than output type,
// which breaks `useForm` typed by the schema's output — the same trap
// documented on `z.coerce.number()` in companies.ts. So an empty text
// input must be converted to `undefined` at the FORM layer
// (`setValueAs`), exactly as numbers are converted there. That keeps
// "no Arabic name" as a single representation (null) rather than two
// ('' and null).
const optionalName = z.string().trim().min(1).max(255).nullable().optional()

export const createClientSchema = z.object({
  enName: z.string().trim().min(1).max(255),
  arName: optionalName,
})
export type CreateClientInput = z.infer<typeof createClientSchema>

// All optional: the same endpoint handles renaming either language
// independently.
export const updateClientSchema = z.object({
  enName: z.string().trim().min(1).max(255).optional(),
  arName: optionalName,
})
export type UpdateClientInput = z.infer<typeof updateClientSchema>

// Deleting a client cascades to every one of its projects, so it gets
// the same typed-confirmation treatment as deleting a company or a
// user. The real "does it match" check happens server-side against the
// stored name — the client doesn't get to assert its own correctness
// about an irreversible cascade. This schema only shapes the request.
export const deleteClientSchema = z.object({
  confirmName: z.string().min(1),
})
export type DeleteClientInput = z.infer<typeof deleteClientSchema>

export interface ClientSummary {
  id: string
  enName: string
  arName: string | null
  createdAt: string
  updatedAt: string
}

/**
 * The tree payload: every client with its projects nested, which is
 * what `GET /clients` returns. One request populates the whole
 * navigation panel — see docs/projects_planing.md section 3.
 */
export interface ClientWithProjects extends ClientSummary {
  projects: ProjectSummary[]
}

/**
 * `GET /clients/:id`. `projectCount` is what the delete dialog must
 * show before it destroys anything.
 */
export interface ClientDetail extends ClientSummary {
  projectCount: number
}
