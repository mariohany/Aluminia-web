import { useTranslation } from 'react-i18next'

export function UsersPage() {
  const { t } = useTranslation('admin')

  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t('usersPage.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('usersPage.comingSoon')}</p>
    </div>
  )
}
