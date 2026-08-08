import { BrowserRouter, Route, Routes } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { queryClient } from '@/lib/query-client'
import { UserRole } from '@repo/types/auth'
import { AuthProvider } from '@/lib/auth-context'
import { ProtectedRoute } from '@/components/protected-route'
import { RoleRoute } from '@/components/role-route'
import { Toaster } from '@/components/ui/sonner'
import { isRtlLanguage } from '@/lib/i18n'
import { LandingPage } from '@/pages/landing-page'
import { LoginPage } from '@/pages/login-page'
import { PrivacyPage } from '@/pages/privacy-page'
import { TermsPage } from '@/pages/terms-page'
import { AdminLayout } from '@/pages/admin/admin-layout'
import { DashboardPage } from '@/pages/admin/dashboard-page'
import { CompaniesPage } from '@/pages/admin/companies-page'
import { CompanyDetailPage } from '@/pages/admin/company-detail-page'
import { UsersPage } from '@/pages/admin/users-page'
import { DataWarehousePage } from '@/pages/admin/data-warehouse-page'
import { WorkspaceLayout } from '@/pages/workspace/workspace-layout'
import { CanvasPage } from '@/pages/workspace/canvas-page'
import { ManagePage } from '@/pages/workspace/manage-page'

function App() {
  const { i18n } = useTranslation()
  // Sonner's `position` names a physical viewport corner, not a
  // logical one — it does NOT mirror with `dir="rtl"` the way the rest
  // of the app's layouts do. Left as the default (bottom-right) it sits
  // exactly where the workspace rail moves TO in Arabic (§3's mirrored
  // layout), and a queue of a few toasts fully covers the logout
  // button — found by actually clicking it during Phase 11 testing,
  // not by inspection. Flipped explicitly here so toasts stay clear of
  // the rail in both directions.
  const toastPosition = isRtlLanguage(i18n.resolvedLanguage ?? 'en') ? 'bottom-left' : 'bottom-right'

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />

            {/* The platform owner's console — unchanged by Phase 11. */}
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <RoleRoute allow={[UserRole.SUPER_ADMIN]}>
                    <AdminLayout />
                  </RoleRoute>
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="companies" element={<CompaniesPage />} />
              <Route path="companies/:id" element={<CompanyDetailPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="data-warehouse" element={<DataWarehousePage />} />
            </Route>

            {/* The manufacturer's application. A super admin is refused
                here, exactly as the API refuses them: they carry no
                company, so there is no tenant to resolve. */}
            <Route
              path="/workspace"
              element={
                <ProtectedRoute>
                  <RoleRoute allow={[UserRole.COMPANY_ADMIN, UserRole.USER]}>
                    <WorkspaceLayout />
                  </RoleRoute>
                </ProtectedRoute>
              }
            >
              {/* Selection lives in the URL so a project OR a client is
                  linkable and survives a refresh. All three routes
                  render the canvas; it reads whichever param is present
                  to decide what to show. */}
              <Route index element={<CanvasPage />} />
              <Route path="projects/:projectId" element={<CanvasPage />} />
              <Route path="clients/:clientId" element={<CanvasPage />} />
              <Route
                path="manage"
                element={
                  <RoleRoute allow={[UserRole.COMPANY_ADMIN]}>
                    <ManagePage />
                  </RoleRoute>
                }
              />
            </Route>

            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      <Toaster position={toastPosition} />
    </QueryClientProvider>
  )
}

export default App
