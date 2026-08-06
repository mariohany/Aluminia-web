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
    <div className="flex min-h-svh">
      <aside className="hidden w-64 shrink-0 border-e border-border bg-background p-4 md:flex">
        <AdminSidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-border px-4 md:hidden">
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

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
