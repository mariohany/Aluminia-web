import { useEffect, useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { CompanyStatus, updateCompanySchema, type UpdateCompanyInput } from '@repo/types/companies'
import { apiErrorMessage } from '@/lib/api-client'
import { useCompanyQuery, useUpdateCompanyMutation } from '@/lib/companies-queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArchiveReactivateDialog } from '@/components/admin/companies/archive-reactivate-dialog'
import { DeleteCompanyDialog } from '@/components/admin/companies/delete-company-dialog'

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation('admin')
  const { data: company, isLoading, isError } = useCompanyQuery(id ?? '')
  const updateMutation = useUpdateCompanyMutation(id ?? '')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateCompanyInput>({
    resolver: zodResolver(updateCompanySchema),
    defaultValues: { name: '', plan: '', maxUsers: 1 },
  })

  useEffect(() => {
    if (company) reset({ name: company.name, plan: company.plan, maxUsers: company.maxUsers })
  }, [company, reset])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  if (!id) return <Navigate to="/app/companies" replace />

  const onSubmit = async (data: UpdateCompanyInput) => {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t('companyDetail.editSection.success'))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('companyDetail.editSection.error')))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/app/companies"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        {t('companyDetail.back')}
      </Link>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        </div>
      )}

      {isError && <p className="text-destructive">{t('companyDetail.notFound')}</p>}

      {company && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-xl font-semibold text-foreground">{company.name}</h1>
              <Badge variant={company.status === CompanyStatus.ACTIVE ? 'default' : 'outline'}>
                {t(`companiesPage.status.${company.status}`)}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <ArchiveReactivateDialog company={company} />
              {company.status === CompanyStatus.SUSPENDED ? (
                <DeleteCompanyDialog
                  company={company}
                  onDeleted={() => navigate('/app/companies', { replace: true })}
                />
              ) : (
                <span className="text-xs text-muted-foreground">{t('companyDetail.actions.deleteRequiresArchive')}</span>
              )}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('companyDetail.editSection.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="detail-name">{t('createCompany.fields.name')}</Label>
                    <Input id="detail-name" className="mt-1.5" aria-invalid={!!errors.name} {...register('name')} />
                    {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
                  </div>
                  <div>
                    <Label htmlFor="detail-plan">{t('createCompany.fields.plan')}</Label>
                    <Input id="detail-plan" className="mt-1.5" aria-invalid={!!errors.plan} {...register('plan')} />
                    {errors.plan && <p className="mt-1 text-xs text-destructive">{errors.plan.message}</p>}
                  </div>
                  <div>
                    <Label htmlFor="detail-max-users">{t('createCompany.fields.maxUsers')}</Label>
                    <Input
                      id="detail-max-users"
                      type="number"
                      min={1}
                      className="mt-1.5"
                      aria-invalid={!!errors.maxUsers}
                      {...register('maxUsers', { valueAsNumber: true })}
                    />
                    {errors.maxUsers && <p className="mt-1 text-xs text-destructive">{errors.maxUsers.message}</p>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t('companyDetail.schemaName')}: {company.schemaName}
                  </span>
                  <span>
                    {t('companyDetail.createdAt')}: {dateFormatter.format(new Date(company.createdAt))}
                  </span>
                  <span>
                    {t('companyDetail.updatedAt')}: {dateFormatter.format(new Date(company.updatedAt))}
                  </span>
                </div>

                <Button type="submit" size="sm" className="w-fit" disabled={!isDirty || isSubmitting}>
                  {t(isSubmitting ? 'companyDetail.editSection.saving' : 'companyDetail.editSection.save')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('companyDetail.usersSection.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {company.users.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('companyDetail.usersSection.empty')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('createCompany.fields.adminEmail')}</TableHead>
                      <TableHead>{t('companyDetail.usersSection.role')}</TableHead>
                      <TableHead>{t('companyDetail.usersSection.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {company.users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{t(`companyDetail.usersSection.roles.${user.role}`)}</TableCell>
                        <TableCell>{t(`companyDetail.usersSection.userStatus.${user.status}`)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('companyDetail.billingSection.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {company.billing.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('companyDetail.billingSection.empty')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('createCompany.fields.plan')}</TableHead>
                      <TableHead>{t('createCompany.fields.maxUsers')}</TableHead>
                      <TableHead>{t('companyDetail.billingSection.effectiveFrom')}</TableHead>
                      <TableHead>{t('companyDetail.billingSection.notes')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {company.billing.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>{record.plan}</TableCell>
                        <TableCell>{record.maxUsers}</TableCell>
                        <TableCell>{dateFormatter.format(new Date(record.effectiveFrom))}</TableCell>
                        <TableCell className="text-muted-foreground">{record.notes ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
