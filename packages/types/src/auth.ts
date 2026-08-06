import { z } from 'zod'

// Canonical role values — shared so the frontend can make role-based UI
// decisions without duplicating (and risking drift from) the backend's
// enum. The `users` entity's `role` column uses this same values.
//
// A `const` object, not a TS `enum`: this package ships raw .ts source
// (no build step — see package.json's `exports`), and apps/api's dev
// server loads it through Node's native TypeScript stripping, which only
// erases type-only syntax. `enum` has real runtime codegen and isn't
// erasable, so it fails there; this object literal is.
export const UserRole = {
  SUPER_ADMIN: 'super_admin',
  COMPANY_ADMIN: 'company_admin',
  USER: 'user',
} as const
export type UserRole = (typeof UserRole)[keyof typeof UserRole]

// Same rationale as UserRole above: a const object, not a TS `enum`.
export const UserStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus]

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

export type LoginRequestInput = z.infer<typeof loginRequestSchema>

export interface AuthenticatedUser {
  id: string
  email: string
  role: UserRole
  companyId: string | null
}

export interface LoginResponse {
  accessToken: string
  user: AuthenticatedUser
}

export type MeResponse = AuthenticatedUser
