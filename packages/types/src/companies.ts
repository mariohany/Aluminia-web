import { z } from 'zod'
import type { UserRole, UserStatus } from './auth'

// Same rationale as UserRole in auth.ts: a const object, not a TS `enum`,
// so it survives erasable-syntax-only TypeScript stripping.
export const CompanyStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const
export type CompanyStatus = (typeof CompanyStatus)[keyof typeof CompanyStatus]

// `maxUsers` is a plain number, not `z.coerce.number()`: coercion gives
// the schema a different input type than output type, which conflicts
// with typing `useForm` by the schema's output (`CreateCompanyInput`).
// The string-to-number conversion happens at the form layer instead
// (`register('maxUsers', { valueAsNumber: true })`).
export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(255),
  plan: z.string().trim().min(1).max(100),
  maxUsers: z.number().int().positive(),
  admin: z.object({
    email: z.email(),
    password: z.string().min(8),
  }),
})
export type CreateCompanyInput = z.infer<typeof createCompanySchema>

// All optional: the same endpoint handles a name-only rename and a
// plan/seat change, and the backend only writes a new `billing` row when
// plan or maxUsers actually changes.
export const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  plan: z.string().trim().min(1).max(100).optional(),
  maxUsers: z.number().int().positive().optional(),
})
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>

// Deleting a company requires typing its name back — a plain "are you
// sure?" isn't enough for something that drops a tenant schema. The
// actual "does it match" check happens server-side against the real
// company name (the client doesn't get to assert its own correctness);
// this schema just shapes the request.
export const deleteCompanySchema = z.object({
  confirmName: z.string().min(1),
})
export type DeleteCompanyInput = z.infer<typeof deleteCompanySchema>

export interface CompanySummary {
  id: string
  name: string
  status: CompanyStatus
  plan: string
  maxUsers: number
  userCount: number
  createdAt: string
}

export interface BillingRecordSummary {
  id: string
  plan: string
  maxUsers: number
  effectiveFrom: string
  notes: string | null
  createdAt: string
}

export interface CompanyUserSummary {
  id: string
  email: string
  role: UserRole
  status: UserStatus
  createdAt: string
}

export interface CompanyDetail extends CompanySummary {
  schemaName: string
  updatedAt: string
  billing: BillingRecordSummary[]
  users: CompanyUserSummary[]
}
