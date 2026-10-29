import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Trash2, Upload } from 'lucide-react'
import {
  documentNumber,
  updateBillingProfileSchema,
  type BillingProfile,
  type UpdateBillingProfileInput,
} from '@repo/types/billing-profile'
import { FILE_PURPOSE_LIMITS, FilePurpose } from '@repo/types/files'
import { apiErrorCode, apiErrorMessage } from '@/lib/api-client'
import { optionalTextField } from '@/lib/form-fields'
import { uploadFile } from '@/lib/files-api'
import { useFileObjectUrl } from '@/lib/files-queries'
import { useBillingProfileQuery, useUpdateBillingProfileMutation } from '@/lib/billing-profile-queries'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredMark } from '@/components/ui/required-mark'
import { Skeleton } from '@/components/ui/skeleton'
import { QuotationPreview } from '@/components/admin/billing/quotation-preview'

const LOGO = FILE_PURPOSE_LIMITS[FilePurpose.BILLING_LOGO]

type TextField = Exclude<keyof UpdateBillingProfileInput, 'logoFileId' | 'nextQuotation' | 'nextInvoice'>

function toForm(profile: BillingProfile): UpdateBillingProfileInput {
  const d = profile.details
  return {
    legalNameEn: d?.legalNameEn ?? '',
    legalNameAr: d?.legalNameAr ?? '',
    addressEn: d?.addressEn ?? '',
    addressAr: d?.addressAr ?? '',
    taxId: d?.taxId ?? '',
    commercialRegister: d?.commercialRegister ?? '',
    billingEmail: d?.billingEmail ?? '',
    phone: d?.phone ?? null,
    bankAccount: d?.bankAccount ?? '',
    instapay: d?.instapay ?? null,
    logoFileId: d?.logoFileId ?? null,
    nextQuotation: profile.numbering.nextQuotation,
    nextInvoice: profile.numbering.nextInvoice,
  }
}

/**
 * Admin › Billing › Billing profile (docs/subscriptions_planing.md B17,
 * board bill-seller-a): the platform's business as printed on every
 * quotation and invoice, one form on the left, a live quotation preview on
 * the right, one Save. The logo uploads at once and applies on Save, like
 * Config › Company profile. Next numbers only go up (the API refuses less).
 */
export function BillingProfilePage() {
  const { t } = useTranslation('admin')
  const { data: profile, isPending, isError } = useBillingProfileQuery()
  const update = useUpdateBillingProfileMutation()

  const {
    control,
    register,
    reset,
    setValue,
    handleSubmit,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<UpdateBillingProfileInput>({
    resolver: zodResolver(updateBillingProfileSchema),
  })

  useEffect(() => {
    if (profile) reset(toForm(profile))
  }, [profile, reset])

  const values = useWatch({ control })
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<{ fileId: string; url: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const savedLogoUrl = useFileObjectUrl(values.logoFileId)
  const logoUrl = preview && preview.fileId === values.logoFileId ? preview.url : savedLogoUrl

  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview.url)
  }, [preview])

  async function pickLogo(file: File | undefined) {
    if (!file) return
    if (!(LOGO.contentTypes as readonly string[]).includes(file.type)) {
      toast.error(t('billingProfile.logo.wrongType'))
      return
    }
    if (file.size > LOGO.maxBytes) {
      toast.error(t('billingProfile.logo.tooBig'))
      return
    }
    setUploading(true)
    try {
      const uploaded = await uploadFile(file, FilePurpose.BILLING_LOGO)
      setPreview({ fileId: uploaded.id, url: URL.createObjectURL(file) })
      setValue('logoFileId', uploaded.id, { shouldDirty: true })
    } catch (err) {
      toast.error(apiErrorMessage(err, t('billingProfile.logo.uploadError')))
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(input: UpdateBillingProfileInput) {
    // Only a changed next number is sent: one issued meanwhile must not
    // make a details-only save fail.
    const { nextQuotation, nextInvoice, ...details } = input
    try {
      const saved = await update.mutateAsync({
        ...details,
        ...(dirtyFields.nextQuotation ? { nextQuotation } : {}),
        ...(dirtyFields.nextInvoice ? { nextInvoice } : {}),
      })
      reset(toForm(saved))
      toast.success(t('billingProfile.saved'))
    } catch (err) {
      toast.error(
        apiErrorCode(err) === 'number_too_low'
          ? t('billingProfile.errors.numberTooLow')
          : apiErrorMessage(err, t('billingProfile.saveError')),
      )
    }
  }

  const year = profile?.numbering.year ?? new Date().getFullYear()

  const field = (
    name: TextField,
    opts: { required?: boolean; dir?: 'ltr' | 'rtl'; mono?: boolean; type?: string; hint?: string } = {},
  ) => {
    const id = `billing-${name}`
    const error = errors[name]
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={id} className="text-xs font-medium">
          <span>
            {t(`billingProfile.fields.${name}`)}
            {opts.required && (
              <>
                {' '}
                <RequiredMark />
              </>
            )}
          </span>
        </Label>
        <Input
          id={id}
          type={opts.type}
          dir={opts.dir}
          className={opts.mono ? 'font-mono' : undefined}
          aria-invalid={!!error}
          {...register(name, opts.required ? undefined : optionalTextField)}
        />
        {error ? (
          <p className="text-xs text-destructive">
            {t(name === 'billingEmail' ? 'billingProfile.errors.email' : 'billingProfile.errors.required')}
          </p>
        ) : (
          opts.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>
        )}
      </div>
    )
  }

  const numberField = (name: 'nextQuotation' | 'nextInvoice', kind: 'quotation' | 'invoice', hint: string) => {
    const id = `billing-${name}`
    const floor = profile?.numbering[name] ?? 1
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={id} className="text-xs font-medium">
          {t(`billingProfile.fields.${name}`)}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            min={floor}
            className="w-28 font-mono"
            aria-invalid={!!errors[name]}
            {...register(name, { valueAsNumber: true })}
          />
          <span className="font-mono text-[12.5px] text-muted-foreground" dir="ltr">
            {Number.isInteger(values[name]) ? documentNumber(kind, year, values[name]!) : '—'}
          </span>
        </div>
        <p className={errors[name] ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {errors[name] ? t('billingProfile.errors.number') : hint}
        </p>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="font-heading text-[22px] font-semibold tracking-tight text-foreground">
            {t('billingProfile.title')}
          </h1>
          <p className="max-w-3xl text-[13px] text-muted-foreground">{t('billingProfile.subtitle')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!isDirty || update.isPending}
          onClick={() => profile && reset(toForm(profile))}
        >
          {t('billingProfile.discard')}
        </Button>
        <Button type="submit" disabled={!isDirty || update.isPending || uploading}>
          <Check aria-hidden="true" />
          {t('billingProfile.save')}
        </Button>
      </div>

      {profile && !profile.details && (
        <p className="text-[12.5px] text-muted-foreground">{t('billingProfile.notSet')}</p>
      )}

      {isError ? (
        <p className="py-6 text-center text-sm text-destructive">{t('billingProfile.loadError')}</p>
      ) : isPending ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Skeleton className="h-[640px] rounded-xl" />
          <Skeleton className="h-[360px] rounded-xl" />
        </div>
      ) : (
        <div className="grid max-w-[1140px] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Card className="gap-0 py-0">
            <CardContent className="flex flex-col gap-4 px-5 py-5">
              <h2 className="text-sm font-semibold text-foreground">{t('billingProfile.sections.business')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('legalNameEn', { required: true, dir: 'ltr' })}
                {field('legalNameAr', { required: true, dir: 'rtl' })}
                {field('addressEn', { required: true, dir: 'ltr' })}
                {field('addressAr', { required: true, dir: 'rtl' })}
                {field('taxId', { required: true, dir: 'ltr', mono: true })}
                {field('commercialRegister', { required: true, dir: 'ltr', mono: true })}
                {field('billingEmail', {
                  required: true,
                  dir: 'ltr',
                  type: 'email',
                  hint: t('billingProfile.hints.billingEmail'),
                })}
                {field('phone', { dir: 'ltr', mono: true, type: 'tel' })}
              </div>

              <div className="flex flex-wrap items-center gap-3.5">
                <span className="flex size-13 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                  {logoUrl ? (
                    <img src={logoUrl} alt={t('billingProfile.logo.alt')} className="size-full object-contain" />
                  ) : (
                    <span className="font-heading text-xl font-bold text-muted-foreground">A</span>
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13px] font-semibold text-foreground">{t('billingProfile.logo.title')}</span>
                  <span className="text-xs text-muted-foreground">{t('billingProfile.logo.rules')}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload className="size-3.5" aria-hidden="true" />
                  {uploading
                    ? t('billingProfile.logo.uploading')
                    : values.logoFileId
                      ? t('billingProfile.logo.replace')
                      : t('billingProfile.logo.upload')}
                </Button>
                {values.logoFileId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={uploading}
                    onClick={() => setValue('logoFileId', null, { shouldDirty: true })}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    {t('billingProfile.logo.remove')}
                  </Button>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept={LOGO.contentTypes.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    void pickLogo(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </div>

              <div className="h-px bg-border" />
              <h2 className="text-sm font-semibold text-foreground">{t('billingProfile.sections.pay')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('bankAccount', { required: true, dir: 'ltr', mono: true })}
                {field('instapay', { dir: 'ltr', mono: true })}
              </div>

              <div className="h-px bg-border" />
              <h2 className="text-sm font-semibold text-foreground">{t('billingProfile.sections.numbering')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {numberField('nextQuotation', 'quotation', t('billingProfile.hints.nextQuotation'))}
                {numberField('nextInvoice', 'invoice', t('billingProfile.hints.nextInvoice'))}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2.5 xl:sticky xl:top-4">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('billingProfile.preview.title')}
            </span>
            <div className="rounded-xl border border-border bg-muted p-4">
              <QuotationPreview
                logoUrl={logoUrl}
                legalNameEn={values.legalNameEn ?? ''}
                legalNameAr={values.legalNameAr ?? ''}
                addressEn={values.addressEn ?? ''}
                addressAr={values.addressAr ?? ''}
                taxId={values.taxId ?? ''}
                commercialRegister={values.commercialRegister ?? ''}
                bankAccount={values.bankAccount ?? ''}
                instapay={values.instapay ?? null}
                number={
                  Number.isInteger(values.nextQuotation)
                    ? documentNumber('quotation', year, values.nextQuotation!)
                    : '—'
                }
              />
            </div>
            <p className="text-xs leading-snug text-muted-foreground">{t('billingProfile.preview.note')}</p>
          </div>
        </div>
      )}
    </form>
  )
}
