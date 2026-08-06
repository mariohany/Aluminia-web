import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import type { UserRole } from '@repo/types/auth'
import { useAuth } from '@/lib/auth-context'

// Renders behind ProtectedRoute, so a user is guaranteed to exist here —
// this only narrows further by role. A hidden nav link protects nothing;
// the server-side RolesGuard is the real boundary, this is convenience.
export function RoleRoute({ allow, children }: { allow: UserRole[]; children: ReactNode }) {
  const { user } = useAuth()

  if (!user || !allow.includes(user.role)) return <Navigate to="/" replace />

  return <>{children}</>
}
