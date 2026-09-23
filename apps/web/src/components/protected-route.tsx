import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '@/lib/auth-context'
import { RouteLoader } from '@/components/route-loader'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) return <RouteLoader />

  if (!user) return <Navigate to="/login" replace />

  return <>{children}</>
}
