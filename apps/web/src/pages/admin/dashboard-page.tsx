import { useTranslation } from 'react-i18next'

export function DashboardPage() {
  const { t } = useTranslation('admin')

  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t('dashboardPage.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('dashboardPage.comingSoon')}</p>
    </div>
  )
}
