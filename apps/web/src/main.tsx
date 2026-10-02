import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './lib/i18n'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* App-wide Light / Dark / System (Mario, 2026-10-02): `.dark` on
        <html> switches every token in index.css; default follows the
        computer, the choice is remembered per browser. */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="aluminia.theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
)
