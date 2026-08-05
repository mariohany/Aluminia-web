import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Loader2, Phone } from 'lucide-react'
import { quoteRequestSchema, type QuoteRequestInput } from '@repo/types/quote-request'
import { submitQuoteRequest } from '@/lib/quote-request'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Section } from '@/components/layout/section'

// A submission faster than this is almost certainly a bot, not a human
// reading the form. Combined with the `website` honeypot field below.
const MIN_HUMAN_SUBMIT_MS = 1500

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

export function QuoteSection() {
  const { t } = useTranslation('quoteForm')
  const { t: tCommon } = useTranslation('common')
  const [state, setState] = useState<SubmitState>('idle')
  const mountedAt = useRef(Date.now())

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    setFocus,
  } = useForm<QuoteRequestInput>({
    resolver: zodResolver(quoteRequestSchema),
    defaultValues: { companyName: '', requesterName: '', phone: '', website: '' },
  })

  const fieldError = (field: 'companyName' | 'requesterName' | 'phone') => {
    if (!errors[field]) return undefined
    const isEmpty = watch(field).trim().length === 0
    if (field === 'phone') return t(isEmpty ? 'errors.phone.required' : 'errors.phone.invalid')
    return t(isEmpty ? `errors.${field}.required` : `errors.${field}.tooLong`)
  }

  const onSubmit = async (data: QuoteRequestInput) => {
    const isLikelyBot = data.website || Date.now() - mountedAt.current < MIN_HUMAN_SUBMIT_MS
    setState('submitting')

    if (isLikelyBot) {
      // Don't tell a bot it was caught — just skip the real submission.
      await new Promise((resolve) => setTimeout(resolve, 400))
      setState('success')
      return
    }

    try {
      await submitQuoteRequest(data)
      setState('success')
    } catch {
      setState('error')
    }
  }

  const onInvalid = () => {
    const firstError = (['companyName', 'requesterName', 'phone'] as const).find((field) => errors[field])
    if (firstError) setFocus(firstError)
  }

  if (state === 'success') {
    return (
      <Section id="quote">
        <div className="mx-auto max-w-lg rounded-lg border border-border bg-secondary/30 p-8 text-center">
          <h2 className="text-2xl font-semibold text-foreground">{t('success.title')}</h2>
          <p className="mt-2 text-muted-foreground">{t('success.body')}</p>
        </div>
      </Section>
    )
  }

  return (
    <Section id="quote">
      <div className="mx-auto max-w-lg">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('heading')}</h2>
          <p className="mt-4 text-muted-foreground">{t('subhead')}</p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(onSubmit, onInvalid)(e)}
          noValidate
          className="mt-10 space-y-5"
        >
          {state === 'error' && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
              <p className="font-medium text-destructive">{t('error.title')}</p>
              <p className="mt-1 text-muted-foreground">{t('error.body')}</p>
              <a href={`tel:${tCommon('phone.number')}`} className="mt-2 inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
                <Phone className="size-4" aria-hidden="true" />
                <bdi>{tCommon('phone.number')}</bdi>
              </a>
            </div>
          )}

          <div>
            <Label htmlFor="companyName">{t('fields.companyName.label')}</Label>
            <Input
              id="companyName"
              autoComplete="organization"
              aria-invalid={!!errors.companyName}
              aria-describedby={errors.companyName ? 'companyName-error' : undefined}
              className="mt-1.5"
              {...register('companyName')}
            />
            {errors.companyName && (
              <p id="companyName-error" role="alert" className="mt-1.5 text-sm text-destructive">
                {fieldError('companyName')}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="requesterName">{t('fields.requesterName.label')}</Label>
            <Input
              id="requesterName"
              autoComplete="name"
              aria-invalid={!!errors.requesterName}
              aria-describedby={errors.requesterName ? 'requesterName-error' : undefined}
              className="mt-1.5"
              {...register('requesterName')}
            />
            {errors.requesterName && (
              <p id="requesterName-error" role="alert" className="mt-1.5 text-sm text-destructive">
                {fieldError('requesterName')}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="phone">{t('fields.phone.label')}</Label>
            <Input
              id="phone"
              type="tel"
              dir="ltr"
              className="mt-1.5 text-start"
              autoComplete="tel"
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? 'phone-error' : undefined}
              {...register('phone')}
            />
            {errors.phone && (
              <p id="phone-error" role="alert" className="mt-1.5 text-sm text-destructive">
                {fieldError('phone')}
              </p>
            )}
          </div>

          {/* Honeypot: hidden from sighted users and keyboard tab order; a
              filled value means it was submitted by a bot, not a person.
              Clip-hidden rather than offset off-screen, since a directional
              offset would need a physical left/right value. */}
          <div className="absolute h-px w-px overflow-hidden p-0 whitespace-nowrap [clip:rect(0,0,0,0)]" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input id="website" type="text" tabIndex={-1} autoComplete="off" {...register('website')} />
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={state === 'submitting'}>
            {state === 'submitting' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {t(state === 'submitting' ? 'submit.submitting' : 'submit.idle')}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            <Trans t={t} i18nKey="privacyNotice" components={{ privacyLink: <Link to="/privacy" className="underline hover:text-foreground" /> }} />
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('phoneCta')}{' '}
          <a href={`tel:${tCommon('phone.number')}`} className="font-medium text-foreground hover:underline">
            <bdi>{tCommon('phone.number')}</bdi>
          </a>
        </p>
      </div>
    </Section>
  )
}
