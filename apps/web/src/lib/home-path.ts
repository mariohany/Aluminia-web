import { UserRole } from '@repo/types/auth'
import type { AuthenticatedUser } from '@repo/types/auth'

/**
 * Where a given identity belongs after logging in.
 *
 * Until Phase 11 there was one destination and the login page simply
 * hardcoded it. Now there are two, and the choice depends on the role —
 * so it gets one definition rather than an inline conditional that the
 * next caller (a post-signup redirect, a "back to app" link) would
 * quietly reimplement.
 */
export function homePathForRole(role: AuthenticatedUser['role']): string {
  return role === UserRole.SUPER_ADMIN ? '/app' : '/workspace'
}
