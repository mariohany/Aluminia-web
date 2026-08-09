import { useState } from 'react'
import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AdminSidebarContent } from '@/components/admin/admin-sidebar-content'
import { isRtlLanguage } from '@/lib/i18n'

export function AdminLayout() {
  const { t, i18n } = useTranslation('admin')
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileSheetSide = isRtlLanguage(i18n.resolvedLanguage ?? 'en') ? 'left' : 'right'

  return (
    <div className="flex h-svh">
      <aside className="hidden w-64 shrink-0 border-e border-border bg-background p-4 md:flex">
        <AdminSidebarContent />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b border-border px-4 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('sidebar.openMenu')}>
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side={mobileSheetSide} className="w-72 p-4">
              <SheetHeader className="sr-only">
                <SheetTitle>{t('sidebar.openMenu')}</SheetTitle>
              </SheetHeader>
              <AdminSidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
        </header>

        {/* Was body-level scroll (min-h-svh, unbounded main). Now main is
            viewport-bounded and scrolls on its own — every other admin
            page renders the same as before (its content still scrolls if
            taller than the viewport, just inside main instead of body),
            while the Logs page can opt into filling this exactly and
            scrolling its own table region instead of main. */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
