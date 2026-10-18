import { z } from 'zod'
import { scopedRefSchema } from '@repo/types/company-lookups'
import { PROJECT_CURRENCIES, type ProjectCurrency } from '@repo/types/projects'

// Config › Project settings (docs/project_settings_planing.md): the
// defaults a NEW project starts with, and the company's list of project
// statuses. No transforms, like every shared schema: blank → null happens
// in the form.

/** The 8 status colours (S8). The web maps each key to a `--status-<key>`
 * token; the tenant migration's CHECK lists the same keys. */
export const PROJECT_STATUS_COLORS = ['grey', 'blue', 'amber', 'green', 'violet', 'sky', 'emerald', 'red'] as const
export type ProjectStatusColor = (typeof PROJECT_STATUS_COLORS)[number]

/** Max lengths; the migration's columns mirror these. A company has at
 * most 5 users, so `responsibleUserIds` can never be longer. */
export const PROJECT_STATUS_LIMITS = {
  name: 60,
  statuses: 30,
  responsible: 5,
} as const

// ----- New-project defaults -----

/** PATCH /project-settings: any subset. Soft refs with no existence check,
 * the same posture as a project's own preferences (projects.ts). */
export const updateProjectSettingsSchema = z
  .object({
    defaultSystemBrand: scopedRefSchema.nullable().optional(),
    defaultSystemCatalog: scopedRefSchema.nullable().optional(),
    currency: z.enum(PROJECT_CURRENCIES).nullable().optional(),
  })
  .strict()
export type UpdateProjectSettingsInput = z.infer<typeof updateProjectSettingsSchema>

export interface ProjectSettings {
  defaultSystemBrand: string | null
  defaultSystemCatalog: string | null
  currency: ProjectCurrency | null
  updatedAt: string
}

// ----- Statuses -----

const statusName = z.string().trim().min(1).max(PROJECT_STATUS_LIMITS.name)
const responsibleUserIds = z.array(z.uuid()).max(PROJECT_STATUS_LIMITS.responsible)

export const createProjectStatusSchema = z
  .object({
    enName: statusName,
    arName: statusName.nullable().optional(),
    color: z.enum(PROJECT_STATUS_COLORS),
    responsibleUserIds,
  })
  .strict()
export type CreateProjectStatusInput = z.infer<typeof createProjectStatusSchema>

export const updateProjectStatusSchema = z
  .object({
    enName: statusName.optional(),
    arName: statusName.nullable().optional(),
    color: z.enum(PROJECT_STATUS_COLORS).optional(),
    responsibleUserIds: responsibleUserIds.optional(),
  })
  .strict()
export type UpdateProjectStatusInput = z.infer<typeof updateProjectStatusSchema>

/** PUT /project-statuses/order: every current status id, in the new order. */
export const reorderProjectStatusesSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(PROJECT_STATUS_LIMITS.statuses) })
  .strict()
export type ReorderProjectStatusesInput = z.infer<typeof reorderProjectStatusesSchema>

/** Users are shown by email: the app has no user names. */
export interface ProjectStatusUser {
  id: string
  email: string
}

export interface ProjectStatus {
  id: string
  /** 1…n, the order projects move through. */
  position: number
  enName: string
  arName: string | null
  color: ProjectStatusColor
  /** Active users of this company only; anyone removed, moved or
   * deactivated is dropped on read. Empty = no one responsible (S7). */
  responsible: ProjectStatusUser[]
  projectCount: number
}
