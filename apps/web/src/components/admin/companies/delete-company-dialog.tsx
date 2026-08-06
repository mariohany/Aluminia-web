import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { CompanySummary } from '@repo/types/companies'
import { apiErrorMessage } from '@/lib/api-client'
import { useDeleteCompanyMutation } from '@/lib/companies-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export function DeleteCompanyDialog({
  company,
  onDeleted,
}: {
  company: CompanySummary
  onDeleted: () => void
}) {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const mutation = useDeleteCompanyMutation(company.id)

  const matches = confirmName === company.name

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync(confirmName)
      toast.success(t('companyDetail.actions.deleteSuccess', { name: company.name }))
      setOpen(false)
      onDeleted()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('companyDetail.actions.error')))
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setConfirmName('')
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          {t('companyDetail.actions.delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('companyDetail.actions.deleteConfirmTitle', { name: company.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('companyDetail.actions.deleteConfirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div>
          <Label htmlFor="delete-confirm-name">
            {t('companyDetail.actions.deleteConfirmLabel', { name: company.name })}
          </Label>
          <Input
            id="delete-confirm-name"
            className="mt-1.5"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t('companyDetail.back')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matches || mutation.isPending}
            onClick={(e) => {
              e.preventDefault()
              void handleDelete()
            }}
          >
            {t('companyDetail.actions.deleteConfirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
