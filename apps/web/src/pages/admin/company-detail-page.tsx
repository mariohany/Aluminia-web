import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Copy, Loader2, Pencil } from 'lucide-react'
import {
  CompanyStatus,
  updateCompanySchema,
  type CompanyDetail,
  type UpdateCompanyInput,
} from '@repo/types/companies'
import type { UserSummary } from '@repo/types/users'
import { BILLING_TIME_ZONE, subscriptionState } from '@repo/types/subscriptions'
import { apiErrorMessage } from '@/lib/api-client'
import { planName } from '@/lib/bilingual'
import { usePlansQuery } from '@/lib/plans-queries'
import { useCompanyQuery, useResetFreeProjectMutation, useUpdateCompanyMutation } from '@/lib/companies-queries'
import { useUsersQuery } from '@/lib/users-queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArchiveReactivateDialog } from '@/components/admin/companies/archive-reactivate-dialog'
import { DeleteCompanyDialog } from '@/components/admin/companies/delete-company-dialog'
import {
  CompanyAvatar,
  CompanyStatusPill,
  NeutralPill,
  StatusPill,
  SubscriptionTag,
} from '@/components/admin/companies/company-badges'
import { EditSubscriptionDialog } from '@/components/admin/companies/edit-subscription-dialog'
import { CompanyDocumentsCard } from '@/components/admin/billing/company-documents-card'
import { useCompanyDocumentsQuery } from '@/lib/billing-queries'
import { RequiredMark } from '@/components/ui/required-mark'
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

const TABS = ['overview', 'billing'] as const
type Tab = (typeof TABS)[number]

/**
 * One company (docs/subscriptions_planing.md B19, design B): header with
 * the archive/delete rule and an "Ends in N days" tag in the last 30
 * days, a stats strip, then two tabs. Overview: both names and the Users
 * card; Billing: the subscription strip with Edit subscription, the
 * documents and the history. The tab is in the URL (`?tab=billing`).
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
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'billing' ? 'billing' : 'overview'
  const [editOpen, setEditOpen] = useState(false)
  // Deactivated by the drop to Free (B13): only the company endpoint knows.
  const planDeactivated = useMemo(
    () => new Set(company.users.filter((user) => user.planDeactivated).map((user) => user.id)),
    [company.users],
  )

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
            <NeutralPill>{planName(company.plan, language)}</NeutralPill>
            <SubscriptionTag company={company} />
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
          <span className="text-xs text-muted-foreground">
            {t('companyDetail.stats.activeCount', { count: company.activeUserCount })}
          </span>
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

      <div role="tablist" aria-label={t('companyDetail.tabs.label')} className="-mb-1 flex gap-6 border-b border-border">
        {TABS.map((tabId) => {
          const on = tab === tabId
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() =>
                setSearchParams(tabId === 'overview' ? {} : { tab: tabId }, { replace: true })
              }
              className={cn(
                '-mb-px h-9.5 border-b-2 text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                on
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`companyDetail.tabs.${tabId}`)}
            </button>
          )
        })}
      </div>

      {tab === 'overview' ? (
        <div role="tabpanel" className="flex flex-col gap-4">
          <DetailsCard company={company} />

          <Card size="sm">
            <CardHeader>
              <CardTitle>{t('companyDetail.usersSection.title')}</CardTitle>
              <CardAction className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {t('companyDetail.usersSection.seatsUsed', {
                    active: numberFormatter.format(company.activeUserCount),
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
                          <span className="flex items-center gap-1.5">
                            <StatusPill active={user.status === 'active'}>{t(`usersPage.status.${user.status}`)}</StatusPill>
                            {planDeactivated.has(user.id) && (
                              <span className="text-xs text-muted-foreground">
                                {t('companyDetail.usersSection.byFreePlan')}
                              </span>
                            )}
                          </span>
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
      ) : (
        <div role="tabpanel" className="flex flex-col gap-4">
          <BillingStrip company={company} language={language} onEdit={() => setEditOpen(true)} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start">
            <CompanyDocumentsCard company={company} />
            <BillingCard company={company} language={language} />
          </div>
          <EditSubscriptionDialog company={company} open={editOpen} onOpenChange={setEditOpen} />
        </div>
      )}

      {dialogs}
    </>
  )
}

// The API takes either name alone; this form always sends both (B20).
const namesSchema = updateCompanySchema.required()

/** The Overview tab's names (B20): both required. */
function DetailsCard({ company }: { company: CompanyDetail }) {
  const { t } = useTranslation('admin')
  const updateMutation = useUpdateCompanyMutation(company.id)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Required<UpdateCompanyInput>>({
    resolver: zodResolver(namesSchema),
    defaultValues: { name: company.name, nameAr: company.nameAr ?? '' },
  })

  // Re-seed after a save (or an archive elsewhere) refetches the company.
  useEffect(() => {
    reset({ name: company.name, nameAr: company.nameAr ?? '' })
  }, [company.name, company.nameAr, reset])

  const onSubmit = async (data: Required<UpdateCompanyInput>) => {
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
      <CardContent className="flex flex-col gap-2">
        <form
          onSubmit={(e) => void handleSubmit(onSubmit)(e)}
          noValidate
          className="grid max-w-4xl gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
        >
          <div>
            <Label htmlFor="detail-name">
              {t('createCompany.fields.name')}
              <RequiredMark />
            </Label>
            <Input id="detail-name" className="mt-1.5" aria-invalid={!!errors.name} {...register('name')} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{t('createCompany.required')}</p>}
          </div>
          <div>
            <Label htmlFor="detail-name-ar">
              {t('createCompany.fields.nameAr')}
              <RequiredMark />
            </Label>
            <Input id="detail-name-ar" dir="rtl" className="mt-1.5" aria-invalid={!!errors.nameAr} {...register('nameAr')} />
            {errors.nameAr && <p className="mt-1 text-xs text-destructive">{t('createCompany.required')}</p>}
          </div>
          {/* Lines up with the inputs: label (text-sm, leading-none = 14px)
              + the inputs' mt-1.5 (6px) = 20px. */}
          <Button type="submit" className="sm:mt-5" disabled={!isDirty || isSubmitting}>
            {t(isSubmitting ? 'companyDetail.editSection.saving' : 'companyDetail.editSection.save')}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{t('companyDetail.editSection.billingHint')}</p>
      </CardContent>
    </Card>
  )
}

/** The Billing tab's strip (board `bill-cd-b`): plan, seat limit, end, unpaid, and Edit subscription. */
function BillingStrip({
  company,
  language,
  onEdit,
}: {
  company: CompanyDetail
  language: string
  onEdit: () => void
}) {
  const { t } = useTranslation('admin')
  const { data: plans } = usePlansQuery()
  const resetPick = useResetFreeProjectMutation(company.id)
  const planSeats = plans?.find((plan) => plan.key === company.plan.key)?.seats
  const state = subscriptionState({ planKey: company.plan.key, endsAt: company.endsAt, isTrial: company.isTrial }, new Date())
  const numberFormatter = new Intl.NumberFormat(language)
  const endFormatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: BILLING_TIME_ZONE })
  // Unpaid = quotations still payable (draft or sent, not expired), in the
  // company's currency.
  const { data: documents } = useCompanyDocumentsQuery(company.id)
  const unpaid = (documents ?? []).filter((d) => d.kind === 'quotation' && (d.status === 'draft' || d.status === 'sent'))
  const money = new Intl.NumberFormat(language, { style: 'currency', currency: unpaid[0]?.currency ?? company.currency })

  const endsCaption =
    state.kind === 'free'
      ? t('companyDetail.strip.neverEnds')
      : state.kind === 'expired'
        ? t('companyDetail.strip.expired')
        : t('companyDetail.strip.daysLeft', { count: state.daysLeft })

  const cells: { label: string; value: string; caption: string }[] = [
    {
      label: t('companyDetail.strip.plan'),
      value: planName(company.plan, language) + (company.isTrial ? ` · ${t('companyDetail.strip.trial')}` : ''),
      caption: t('companyDetail.strip.planCaption', {
        currency: company.currency,
        vat: numberFormatter.format(company.vatRate),
      }),
    },
    {
      label: t('companyDetail.strip.seats'),
      value: numberFormatter.format(company.maxUsers),
      caption:
        planSeats === company.maxUsers
          ? t('companyDetail.strip.seatsDefault', { count: company.userCount })
          : t('companyDetail.strip.seatsCustom', { seats: planSeats ?? '—', count: company.userCount }),
    },
    {
      label: t('companyDetail.strip.ends'),
      value: company.endsAt ? endFormatter.format(new Date(company.endsAt)) : '—',
      caption: endsCaption,
    },
    {
      label: t('companyDetail.strip.unpaid'),
      value: unpaid.length ? money.format(unpaid.reduce((sum, d) => sum + d.totals.total, 0)) : '—',
      caption: unpaid.length
        ? t('companyDetail.strip.unpaidCount', { count: unpaid.length })
        : t('companyDetail.strip.noUnpaid'),
    },
  ]

  return (
    <section
      aria-label={t('companyDetail.strip.label')}
      className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:flex-row"
    >
      <div className="grid flex-1 grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x rtl:lg:divide-x-reverse">
        {cells.map((cell) => (
          <div key={cell.label} className="flex min-w-0 flex-col gap-1 px-4 py-3.5">
            <span className="text-xs text-muted-foreground">{cell.label}</span>
            <span className="truncate text-[15px] font-semibold text-foreground">{cell.value}</span>
            <span className="truncate text-xs text-muted-foreground">{cell.caption}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3 lg:border-s lg:border-t-0">
        {company.plan.key === 'free' && company.freeProjectId && (
          <Button
            variant="ghost"
            size="sm"
            disabled={resetPick.isPending}
            title={t('companyDetail.strip.resetPickHint')}
            onClick={() =>
              resetPick.mutate(undefined, {
                onSuccess: () => toast.success(t('companyDetail.strip.resetPickDone')),
                onError: (err) => toast.error(apiErrorMessage(err, t('companyDetail.actions.error'))),
              })
            }
          >
            {t('companyDetail.strip.resetPick')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          {t('subscription.title')}
        </Button>
      </div>
    </section>
  )
}

/** The history (§3c), newest first: what changed, why and who. */
function BillingCard({ company, language }: { company: CompanyDetail; language: string }) {
  const { t } = useTranslation('admin')
  const records = company.billing
  const dateFormatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium' })
  const endFormatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: BILLING_TIME_ZONE })

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('companyDetail.billingSection.title')}</CardTitle>
        {records.length > 0 && (
          <CardAction className="text-xs text-muted-foreground">
            {t('companyDetail.billingSection.changes', { count: records.length })}
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('companyDetail.billingSection.empty')}</p>
        ) : (
          <ol className="flex flex-col">
            {records.map((record, index) => {
              const details = [
                record.endsAt && t('companyDetail.billingSection.endsOn', { date: endFormatter.format(new Date(record.endsAt)) }),
                record.notes,
                record.actorEmail,
              ].filter(Boolean)
              return (
                <li key={record.id} className={cn('flex gap-2.5 py-2.5', index > 0 && 'border-t border-border')}>
                  <span
                    className={cn('mt-1.5 size-2 shrink-0 rounded-full', index === 0 ? 'bg-primary' : 'bg-muted-foreground')}
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-foreground">
                      {t(`companyDetail.billingSection.reasons.${record.reason}`, {
                        plan: planName(record.plan, language),
                        count: record.maxUsers,
                      })}
                    </span>
                    {details.length > 0 && (
                      <span className="text-xs break-words text-muted-foreground">{details.join(' · ')}</span>
                    )}
                  </div>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {dateFormatter.format(new Date(record.effectiveFrom))}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
