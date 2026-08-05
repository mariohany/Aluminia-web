import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/layout/container'

export function AppPage() {
  const { t } = useTranslation('app')
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    void navigate('/login', { replace: true })
  }

  return (
    <Container className="flex min-h-svh flex-col items-center justify-center gap-4 text-center">
      {user && <p className="text-muted-foreground">{t('loggedInAs', { email: user.email })}</p>}
      <p className="text-lg font-medium text-foreground">{t('placeholder')}</p>
      <Button variant="outline" onClick={() => void handleLogout()}>
        {t('logout')}
      </Button>
    </Container>
  )
}
