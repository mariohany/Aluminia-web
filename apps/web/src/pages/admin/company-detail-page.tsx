import { useEffect, useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Copy, Loader2 } from 'lucide-react'
import {
  CompanyStatus,
  updateCompanySchema,
  type CompanyDetail,
  type UpdateCompanyInput,
} from '@repo/types/companies'
import type { UserSummary } from '@repo/types/users'
import { apiErrorMessage } from '@/lib/api-client'
import { useCompanyQuery, useUpdateCompanyMutation } from '@/lib/companies-queries'
import { useUsersQuery } from '@/lib/users-queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArchiveReactivateDialog } from '@/components/admin/companies/archive-reactivate-dialog'
import { DeleteCompanyDialog } from '@/components/admin/companies/delete-company-dialog'
import { CompanyAvatar, CompanyStatusPill, NeutralPill, StatusPill } from '@/components/admin/companies/company-badges'
import { CreateUserDialog } from '@/components/admin/users/create-user-dialog'
import { useUserRowActions } from '@/components/admin/users/user-row-actions'
import { LastActivity, UserAvatar, UserRolePill } from '@/components/admin/users/user-badges'

/** Whole calendar months between two dates (0 within the same month). */
function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth())
}

/** Seats used out of the limit: amber from 80%, red when full. */
function SeatMeter({ used, max, label }: { used: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(used / max, 1) : 0
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={used}
      className="h-1.5 w-full overflow-hidden rounded-full bg-accent"
    >
      <div
        className={cn('h-full rounded-full', ratio >= 1 ? 'bg-destructive' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-primary')}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-heading text-[22px] leading-7 font-semibold tracking-tight text-foreground">{value}</span>
      {children}
    </div>
  )
}

/**
 * One company, everything on one screen (docs/admin_redesign_planing.md
 * §4 — Mario: no tabs): header with the archive/delete rule, a stats
 * strip, the Details form and the Users card (add / edit users here) on
 * the left, the billing timeline on the right.
 */
export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation('admin')
  const { data: company, isLoading, isError } = useCompanyQuery(id ?? '')

  if (!id) return <Navigate to="/app/companies" replace />

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/app/companies"
        className="flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

      {company && <CompanyView key={company.id} company={company} language={i18n.language} />}
    </div>
  )
}

function CompanyView({ company, language }: { company: CompanyDetail; language: string }) {
  const { t } = useTranslation('admin')
  const navigate = useNavigate()
  const { data: allUsers, isLoading: usersLoading } = useUsersQuery()
  const { renderMenu, dialogs } = useUserRowActions()

  // The admin users list (shared with the Users page) carries `online` and
  // `lastActiveAt`, which the company endpoint's own user list doesn't.
  const users: UserSummary[] = useMemo(
    () => (allUsers ?? []).filter((user) => user.companyId === company.id),
    [allUsers, company.id],
  )
  const onlineCount = users.filter((user) => user.online).length

  const numberFormatter = useMemo(() => new Intl.NumberFormat(language), [language])
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium' }), [language])
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(language, { month: 'short', year: 'numeric' }), [language])
  const activityFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  )

  const created = new Date(company.createdAt)
  const months = monthsBetween(created, new Date())
  const archived = company.status === CompanyStatus.SUSPENDED
  const seatsFull = company.userCount >= company.maxUsers

  const copySchema = async () => {
    try {
      await navigator.clipboard.writeText(company.schemaName)
      toast.success(t('companyDetail.schemaCopied'))
    } catch {
      toast.error(t('companyDetail.actions.error'))
    }
  }

  return (
    <>
      {/* Header: name, pills, schema, and today's archive-then-delete rule. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <CompanyAvatar name={company.name} className="size-11 rounded-lg text-sm" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">{company.name}</h1>
            <CompanyStatusPill status={company.status} />
            <NeutralPill>{company.plan}</NeutralPill>
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="font-mono text-foreground" dir="ltr">
              {company.schemaName}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-6"
              aria-label={t('companyDetail.copySchema')}
              title={t('companyDetail.copySchema')}
              onClick={() => void copySchema()}
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </Button>
            <span aria-hidden="true">·</span>
            <span>
              {t('companyDetail.headerDates', {
                created: dateFormatter.format(created),
                updated: dateFormatter.format(new Date(company.updatedAt)),
              })}
            </span>
          </div>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          {archived ? (
            <DeleteCompanyDialog company={company} onDeleted={() => void navigate('/app/companies', { replace: true })} />
          ) : (
            <span className="max-w-60 text-end text-xs text-muted-foreground">
              {t('companyDetail.actions.deleteRequiresArchive')}
            </span>
          )}
          <ArchiveReactivateDialog company={company} />
        </div>
      </div>

      {/* Stats strip */}
      <section
        aria-label={t('companyDetail.stats.label')}
        className="grid grid-cols-2 divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:grid-cols-4 lg:divide-x rtl:lg:divide-x-reverse"
      >
        <Stat
          label={t('companyDetail.stats.seats')}
          value={t('companyDetail.stats.seatsValue', {
            used: numberFormatter.format(company.userCount),
            max: numberFormatter.format(company.maxUsers),
          })}
        >
          <div className="pt-1">
            <SeatMeter used={company.userCount} max={company.maxUsers} label={t('companyDetail.stats.seats')} />
          </div>
        </Stat>
        <Stat
          label={t('companyDetail.stats.projects')}
          value={company.projectCount === null ? '—' : numberFormatter.format(company.projectCount)}
        >
          <span className="text-xs text-muted-foreground">
            {company.projectCount === null ? t('companyDetail.stats.projectsArchived') : t('companyDetail.stats.projectsCaption')}
          </span>
        </Stat>
        <Stat label={t('companyDetail.stats.online')} value={usersLoading ? '…' : numberFormatter.format(onlineCount)}>
          <span className="text-xs text-muted-foreground">
            {t('companyDetail.stats.onlineCaption', { count: users.length })}
          </span>
        </Stat>
        <Stat label={t('companyDetail.stats.since')} value={monthFormatter.format(created)}>
          <span className="text-xs text-muted-foreground">
            {months === 0 ? t('companyDetail.stats.sinceNew') : t('companyDetail.stats.sinceMonths', { count: months })}
          </span>
        </Stat>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <DetailsCard company={company} />

          <Card size="sm">
            <CardHeader>
              <CardTitle>{t('companyDetail.usersSection.title')}</CardTitle>
              <CardAction className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {t('companyDetail.usersSection.seatsUsed', {
                    used: numberFormatter.format(company.userCount),
                    max: numberFormatter.format(company.maxUsers),
                  })}
                </span>
                <CreateUserDialog
                  company={{ id: company.id, name: company.name }}
                  disabledReason={seatsFull ? t('companyDetail.usersSection.seatLimitReached') : undefined}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="h-24 animate-pulse rounded bg-muted" />
              ) : users.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('companyDetail.usersSection.empty')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{t('usersPage.table.email')}</TableHead>
                      <TableHead className="text-xs">{t('companyDetail.usersSection.role')}</TableHead>
                      <TableHead className="text-xs">{t('companyDetail.usersSection.status')}</TableHead>
                      <TableHead className="text-xs">{t('usersPage.table.lastActivity')}</TableHead>
                      <TableHead className="w-10">
                        <span className="sr-only">{t('usersPage.table.actions')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <span className="flex items-center gap-2.5">
                            <UserAvatar email={user.email} />
                            <span className="truncate">{user.email}</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <UserRolePill role={user.role} />
                        </TableCell>
                        <TableCell>
                          <StatusPill active={user.status === 'active'}>{t(`usersPage.status.${user.status}`)}</StatusPill>
                        </TableCell>
                        <TableCell>
                          <LastActivity user={user} formatter={activityFormatter} />
                        </TableCell>
                        <TableCell>{renderMenu(user)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Pinned to the left column's height from lg up (absolute inside a
            stretched cell), so a long history scrolls instead of growing
            the page. */}
        <div className="lg:relative">
          <BillingCard company={company} dateFormatter={dateFormatter} />
        </div>
      </div>

      {dialogs}
    </>
  )
}

function DetailsCard({ company }: { company: CompanyDetail }) {
  const { t } = useTranslation('admin')
  const updateMutation = useUpdateCompanyMutation(company.id)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateCompanyInput>({
    resolver: zodResolver(updateCompanySchema),
    defaultValues: { name: company.name, plan: company.plan, maxUsers: company.maxUsers },
  })

  // Re-seed after a save (or an archive elsewhere) refetches the company.
  useEffect(() => {
    reset({ name: company.name, plan: company.plan, maxUsers: company.maxUsers })
  }, [company.name, company.plan, company.maxUsers, reset])

  const onSubmit = async (data: UpdateCompanyInput) => {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t('companyDetail.editSection.success'))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('companyDetail.editSection.error')))
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('companyDetail.editSection.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => void handleSubmit(onSubmit)(e)}
          noValidate
          className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
        >
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
          {/* Lines up with the inputs: label (text-sm, leading-none = 14px)
              + the inputs' mt-1.5 (6px) = 20px. */}
          <Button type="submit" className="sm:mt-5" disabled={!isDirty || isSubmitting}>
            {t(isSubmitting ? 'companyDetail.editSection.saving' : 'companyDetail.editSection.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** Plan / seat changes, newest first, as a timeline filling the right column. */
function BillingCard({ company, dateFormatter }: { company: CompanyDetail; dateFormatter: Intl.DateTimeFormat }) {
  const { t } = useTranslation('admin')
  const records = company.billing

  return (
    <Card size="sm" className="lg:absolute lg:inset-0">
      <CardHeader>
        <CardTitle>{t('companyDetail.billingSection.title')}</CardTitle>
        {records.length > 0 && (
          <CardAction className="text-xs text-muted-foreground">
            {t('companyDetail.billingSection.changes', { count: records.length })}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('companyDetail.billingSection.empty')}</p>
        ) : (
          <ol className="flex flex-col">
            {records.map((record, index) => {
              const last = index === records.length - 1
              return (
                <li key={record.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn('mt-1 size-2.5 shrink-0 rounded-full', index === 0 ? 'bg-primary' : 'bg-muted-foreground')}
                      aria-hidden="true"
                    />
                    {!last && <span className="w-0.5 flex-1 bg-border" aria-hidden="true" />}
                  </div>
                  <div className={cn('flex min-w-0 flex-col gap-0.5', !last && 'pb-4')}>
                    <span className="text-sm font-medium text-foreground">
                      {t('companyDetail.billingSection.entry', { plan: record.plan, count: record.maxUsers })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('companyDetail.billingSection.from', { date: dateFormatter.format(new Date(record.effectiveFrom)) })}
                      {record.notes && ` · ${record.notes}`}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
