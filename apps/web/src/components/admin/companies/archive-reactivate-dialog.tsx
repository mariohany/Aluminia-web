import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CompanyStatus, type CompanySummary } from '@repo/types/companies'
import { apiErrorMessage } from '@/lib/api-client'
import { useArchiveCompanyMutation, useReactivateCompanyMutation } from '@/lib/companies-queries'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export function ArchiveReactivateDialog({ company }: { company: CompanySummary }) {
  const { t } = useTranslation('admin')
  const archiveMutation = useArchiveCompanyMutation(company.id)
  const reactivateMutation = useReactivateCompanyMutation(company.id)

  if (company.status === CompanyStatus.ACTIVE) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm">
            {t('companyDetail.actions.archive')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('companyDetail.actions.archiveConfirmTitle', { name: company.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('companyDetail.actions.archiveConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('companyDetail.back')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              onClick={async () => {
                try {
                  await archiveMutation.mutateAsync()
                  toast.success(t('companyDetail.actions.archiveSuccess', { name: company.name }))
                } catch (err) {
                  toast.error(apiErrorMessage(err, t('companyDetail.actions.error')))
                }
              }}
            >
              {t('companyDetail.actions.archiveConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t('companyDetail.actions.reactivate')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('companyDetail.actions.reactivateConfirmTitle', { name: company.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('companyDetail.actions.reactivateConfirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('companyDetail.back')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={reactivateMutation.isPending}
            onClick={async () => {
              try {
                await reactivateMutation.mutateAsync()
                toast.success(t('companyDetail.actions.reactivateSuccess', { name: company.name }))
              } catch (err) {
                toast.error(apiErrorMessage(err, t('companyDetail.actions.error')))
              }
            }}
          >
            {t('companyDetail.actions.reactivateConfirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
