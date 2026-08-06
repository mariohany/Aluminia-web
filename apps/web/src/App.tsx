import { BrowserRouter, Route, Routes } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { UserRole } from '@repo/types/auth'
import { AuthProvider } from '@/lib/auth-context'
import { ProtectedRoute } from '@/components/protected-route'
import { RoleRoute } from '@/components/role-route'
import { Toaster } from '@/components/ui/sonner'
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
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
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App
