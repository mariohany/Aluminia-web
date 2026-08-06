import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { LanguageSwitcher } from '@/components/language-switcher'
import { AdminNav } from '@/components/admin/admin-nav'

export function AdminSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    void navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="px-1 text-lg font-semibold tracking-tight text-foreground">{tCommon('appName')}</div>

      <AdminNav onNavigate={onNavigate} />

      <div className="mt-auto flex flex-col gap-3">
        <Separator />
        {user && <p className="truncate px-1 text-xs text-muted-foreground">{t('sidebar.loggedInAs', { email: user.email })}</p>}
        <LanguageSwitcher className="self-start" />
        <Button variant="outline" size="sm" className="justify-start" onClick={() => void handleLogout()}>
          <LogOut className="size-4" aria-hidden="true" />
          {t('sidebar.logout')}
        </Button>
      </div>
    </div>
  )
}
