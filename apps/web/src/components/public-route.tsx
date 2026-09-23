import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '@/lib/auth-context'
import { homePathForRole } from '@/lib/home-path'
import { RouteLoader } from '@/components/route-loader'

interface PublicRouteProps {
  children: ReactNode
  /**
   * What to show while the session is still being restored.
   *
   * `children` — render straight away. The landing page's job is to be
   * read by strangers; making every anonymous visitor wait on a
   * `/auth/refresh` round trip before seeing any copy would be a bad
   * trade for redirecting the one person who is already signed in
   * (they see it for a moment, then land in their workspace).
   *
   * `loader` — hold. For the login form, showing credentials fields to
   * someone who is about to be redirected away is exactly the
   * confusion this guard exists to remove.
   */
  whileResolving?: 'children' | 'loader'
}

/**
 * The mirror of `ProtectedRoute`: a page that signed-in users have no
 * reason to be looking at. Sends them to `homePathForRole` instead —
 * the same destination the login form uses on success, so "open the
 * site" and "log in" land in the same place.
 */
export function PublicRoute({
  children,
  whileResolving = 'loader',
}: PublicRouteProps) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return whileResolving === 'children' ? <>{children}</> : <RouteLoader />
  }

  if (user) return <Navigate to={homePathForRole(user.role)} replace />

  return <>{children}</>
}
