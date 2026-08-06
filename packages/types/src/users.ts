import { z } from 'zod'
// Type-only, like companies.ts's import from './auth' — erased entirely
// at compile time, so it never needs runtime module resolution. The
// role values below are written as literal strings rather than
// `UserRole.COMPANY_ADMIN` etc. specifically to avoid a real (value)
// cross-file import here: apps/api's dev server loads this package
// through Node's native TypeScript stripping (no bundler), which has
// its own extension-resolution rules for relative specifiers that
// diverge from `tsc`'s NodeNext mode — not worth fighting for three
// fixed, effectively-frozen string constants.
import type { UserRole, UserStatus } from './auth'

// Only company-scoped roles are creatable here — a bare super admin
// (no company) isn't a described use case for this screen; the seed
// script covers that. `companyId` is required to match the DB check
// constraint (`role != 'super_admin' => company_id IS NOT NULL`).
export const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(['company_admin', 'user']),
  companyId: z.string().min(1),
})
export type CreateUserInput = z.infer<typeof createUserSchema>

// `role` and `companyId` are independently optional here — the backend
// merges whatever's provided onto the existing user and validates the
// *result* against the role/company invariant, so a plain role toggle
// between company_admin and user (company unchanged) doesn't need to
// resend companyId. Crossing the super-admin boundary does require both
// together: promoting sends `role: 'super_admin', companyId: null`;
// demoting sends the new role plus a companyId.
export const updateUserSchema = z.object({
  email: z.email().optional(),
  role: z.enum(['super_admin', 'company_admin', 'user']).optional(),
  companyId: z.string().nullable().optional(),
})
export type UpdateUserInput = z.infer<typeof updateUserSchema>

export const resetUserPasswordSchema = z.object({
  password: z.string().min(8),
})
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>

// Deleting a user requires typing their email back, same irreversible-
// action policy as deleting a company. The actual match check happens
// server-side against the real email.
export const deleteUserSchema = z.object({
  confirmEmail: z.string().min(1),
})
export type DeleteUserInput = z.infer<typeof deleteUserSchema>

export interface UserSummary {
  id: string
  email: string
  role: UserRole
  status: UserStatus
  companyId: string | null
  companyName: string | null
  createdAt: string
  online: boolean
  lastActiveAt: string | null
}
