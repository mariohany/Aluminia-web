import { BrowserRouter, Route, Routes } from 'react-router'
import { LandingPage } from '@/pages/landing-page'
import { LoginPage } from '@/pages/login-page'
import { PrivacyPage } from '@/pages/privacy-page'
import { TermsPage } from '@/pages/terms-page'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
