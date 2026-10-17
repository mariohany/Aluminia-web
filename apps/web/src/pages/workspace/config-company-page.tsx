import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { z } from 'zod'
import { Building2, Check, Trash2, Upload } from 'lucide-react'
import { updateCompanyProfileSchema, type CompanyProfile } from '@repo/types/company-profile'
import { FILE_PURPOSE_LIMITS, FilePurpose } from '@repo/types/files'
import { apiErrorMessage } from '@/lib/api-client'
import { optionalTextField } from '@/lib/form-fields'
import { uploadFile } from '@/lib/files-api'
import { useFileObjectUrl } from '@/lib/files-queries'
import { useCompanyProfileQuery, useUpdateCompanyProfileMutation } from '@/lib/company-profile-queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel } from '@/components/workspace/field-label'
import { ConfigSectionHeader } from '@/components/workspace/config/config-section-header'
import { LetterheadPreview } from '@/components/workspace/config/letterhead-preview'

// The text fields; the logo is held apart (below) because it is a file id,
// not something typed.
const profileFormSchema = updateCompanyProfileSchema.omit({ logoFileId: true }).required({ enName: true })
type ProfileForm = z.infer<typeof profileFormSchema>

const LOGO = FILE_PURPOSE_LIMITS[FilePurpose.LOGO]

/** A new logo is uploaded at once (`POST /files`) but only becomes the
 * profile's on Save, like the text fields (Q3); Discard drops it and the
 * unused upload is swept by the API after 24 h. */
type LogoDraft = { kind: 'unchanged' } | { kind: 'new'; fileId: string; previewUrl: string } | { kind: 'removed' }

function toForm(profile: CompanyProfile): ProfileForm {
  return {
    enName: profile.enName,
    arName: profile.arName,
    enAddress: profile.enAddress,
    arAddress: profile.arAddress,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    taxId: profile.taxId,
    commercialRegister: profile.commercialRegister,
  }
}

/**
 * Config › Company profile (/workspace/config/company,
 * docs/company_profile_planing.md §6, board D "card opened · Company
 * profile"): the letterhead printed on reports and quotes. One card of
 * label · fields rows, a live paper preview, and one Save / Discard for
 * the whole page.
 */
export function ConfigCompanyPage() {
  const { t } = useTranslation('workspace')
  const profileQuery = useCompanyProfileQuery()
  const updateMutation = useUpdateCompanyProfileMutation()
  const profile = profileQuery.data

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { enName: '' },
  })

  // Refill from the server copy whenever it changes (first load, after a
  // save). A refetch that finds nothing new keeps the same object, so an
  // edit in progress is not wiped.
  useEffect(() => {
    if (profile) reset(toForm(profile))
  }, [profile, reset])

  const [logo, setLogo] = useState<LogoDraft>({ kind: 'unchanged' })
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const savedLogoUrl = useFileObjectUrl(profile?.logoFileId)
  const logoUrl = logo.kind === 'new' ? logo.previewUrl : logo.kind === 'removed' ? null : savedLogoUrl

  // A picked logo's preview is a local object URL; free it when replaced.
  useEffect(() => {
    if (logo.kind !== 'new') return
    return () => URL.revokeObjectURL(logo.previewUrl)
  }, [logo])

  const dirty = isDirty || logo.kind !== 'unchanged'

  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    if (!(LOGO.contentTypes as readonly string[]).includes(file.type)) {
      toast.error(t('config.company.logo.wrongType'))
      return
    }
    if (file.size > LOGO.maxBytes) {
      toast.error(t('config.company.logo.tooBig'))
      return
    }
    setUploading(true)
    try {
      const uploaded = await uploadFile(file, FilePurpose.LOGO)
      setLogo({ kind: 'new', fileId: uploaded.id, previewUrl: URL.createObjectURL(file) })
    } catch (err) {
      toast.error(apiErrorMessage(err, t('config.company.logo.uploadError')))
    } finally {
      setUploading(false)
    }
  }

  const removeLogo = () =>
    setLogo(logo.kind === 'new' && !profile?.logoFileId ? { kind: 'unchanged' } : { kind: 'removed' })

  const discard = () => {
    if (profile) reset(toForm(profile))
    setLogo({ kind: 'unchanged' })
  }

  const onSubmit = async (values: ProfileForm) => {
    try {
      await updateMutation.mutateAsync({
        ...values,
        ...(logo.kind === 'new' ? { logoFileId: logo.fileId } : logo.kind === 'removed' ? { logoFileId: null } : {}),
      })
      setLogo({ kind: 'unchanged' })
      toast.success(t('config.company.saved'))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('config.company.saveError')))
    }
  }

  const values = useWatch({ control })
  const hasLogo = !!logoUrl || (logo.kind === 'unchanged' && !!profile?.logoFileId)

  const field = (
    name: keyof ProfileForm,
    label: string,
    opts: { dir?: 'ltr' | 'rtl'; mono?: boolean; type?: string; optional?: boolean } = {},
  ) => (
    <div className="min-w-0">
      <FieldLabel htmlFor={`company-${name}`} optional={opts.optional ?? true}>
        {label}
      </FieldLabel>
      <Input
        id={`company-${name}`}
        type={opts.type}
        dir={opts.dir}
        className={opts.mono ? 'mt-1.5 font-mono' : 'mt-1.5'}
        aria-invalid={!!errors[name]}
        {...register(name, name === 'enName' ? undefined : optionalTextField)}
      />
      {errors[name] && <p className="mt-1 text-xs text-destructive">{errors[name].message}</p>}
    </div>
  )

  return (
    <div className="flex flex-col gap-4 p-4 md:px-9 md:py-6">
      <ConfigSectionHeader title={t('config.sections.company.title')} />

      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs md:p-5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
            <Building2 className="size-[18px]" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="font-heading text-[17px] font-semibold tracking-tight text-foreground">
              {t('config.sections.company.title')}
            </h1>
            <p className="text-[12.5px] text-muted-foreground">{t('config.company.description')}</p>
          </div>
        </div>

        {profileQuery.isLoading && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('tree.loading')}</p>
        )}
        {profileQuery.isError && (
          <p className="py-6 text-center text-sm text-destructive">{t('config.company.loadError')}</p>
        )}

        {profile && (
          <>
            <div className="flex flex-col">
              <Row title={t('config.company.rows.logo.title')} hint={t('config.company.rows.logo.hint')}>
                <div className="flex flex-wrap items-center gap-3.5">
                  <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                    {logoUrl ? (
                      <img src={logoUrl} alt={t('config.company.logo.alt')} className="size-full object-contain" />
                    ) : (
                      <Building2 className="size-6 text-muted-foreground" aria-hidden="true" />
                    )}
                  </span>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploading}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload className="size-3.5" aria-hidden="true" />
                        {uploading
                          ? t('config.company.logo.uploading')
                          : hasLogo
                            ? t('config.company.logo.replace')
                            : t('config.company.logo.upload')}
                      </Button>
                      {hasLogo && (
                        <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={removeLogo}>
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          {t('config.company.logo.remove')}
                        </Button>
                      )}
                    </div>
                    <span className="text-[11.5px] text-muted-foreground">{t('config.company.logo.rules')}</span>
                  </div>
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
              </Row>

              <Row title={t('config.company.rows.name.title')} hint={t('config.company.rows.name.hint')}>
                <Grid2>
                  {field('enName', t('config.company.fields.english'), { dir: 'ltr', optional: false })}
                  {field('arName', t('config.company.fields.arabic'), { dir: 'rtl' })}
                </Grid2>
              </Row>

              <Row title={t('config.company.rows.address.title')} hint={t('config.company.rows.address.hint')}>
                <Grid2>
                  {field('enAddress', t('config.company.fields.english'), { dir: 'ltr' })}
                  {field('arAddress', t('config.company.fields.arabic'), { dir: 'rtl' })}
                </Grid2>
              </Row>

              <Row title={t('config.company.rows.contact.title')} hint={t('config.company.rows.contact.hint')}>
                <Grid2>
                  {field('phone', t('config.company.fields.phone'), { dir: 'ltr', mono: true, type: 'tel' })}
                  {field('email', t('config.company.fields.email'), { dir: 'ltr', type: 'email' })}
                  {field('website', t('config.company.fields.website'), { dir: 'ltr' })}
                </Grid2>
              </Row>

              <Row
                title={t('config.company.rows.registration.title')}
                hint={t('config.company.rows.registration.hint')}
              >
                <Grid2>
                  {field('taxId', t('config.company.fields.taxId'), { dir: 'ltr', mono: true })}
                  {field('commercialRegister', t('config.company.fields.commercialRegister'), {
                    dir: 'ltr',
                    mono: true,
                  })}
                </Grid2>
              </Row>

              <Row title={t('config.company.rows.paper.title')} hint={t('config.company.rows.paper.hint')}>
                <LetterheadPreview
                  logoUrl={logoUrl}
                  enName={values.enName?.trim() || profile.enName}
                  arName={values.arName?.trim() || null}
                  enAddress={values.enAddress?.trim() || null}
                  arAddress={values.arAddress?.trim() || null}
                  phone={values.phone?.trim() || null}
                  taxId={values.taxId?.trim() || null}
                  commercialRegister={values.commercialRegister?.trim() || null}
                />
              </Row>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {dirty ? (
                <span className="inline-flex items-center gap-2 text-[12.5px] text-amber-700 dark:text-amber-400">
                  <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {t('config.company.unsaved')}
                </span>
              ) : (
                <span className="text-[12.5px] text-muted-foreground">{t('config.company.allSaved')}</span>
              )}
              <span className="flex-1" />
              <Button type="button" variant="outline" disabled={!dirty || isSubmitting} onClick={discard}>
                {t('actions.discard')}
              </Button>
              <Button type="submit" disabled={!dirty || isSubmitting || uploading}>
                <Check className="size-4" aria-hidden="true" />
                {t('actions.save')}
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

/** One label · fields row of the card (board D). */
function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-border py-4 md:grid-cols-[260px_minmax(0,1fr)] md:gap-7">
      <div className="flex flex-col gap-1">
        <span className="text-[13.5px] font-semibold text-foreground">{title}</span>
        <span className="text-[12.5px] leading-snug text-muted-foreground">{hint}</span>
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2.5">{children}</div>
    </div>
  )
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}
