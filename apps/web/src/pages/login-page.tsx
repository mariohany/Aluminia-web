import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { loginRequestSchema, type LoginRequestInput } from '@repo/types/auth'
import { useAuth } from '@/lib/auth-context'
import { homePathForRole } from '@/lib/home-path'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Container } from '@/components/layout/container'

export function LoginPage() {
  const { t } = useTranslation('login')
  const { login } = useAuth()
  const navigate = useNavigate()
  // What the alert says, or null: wrong credentials, the failed-login
  // limit (429) with the minutes left when the API says, or sign-in
  // being briefly unavailable (503, the API's Redis is down).
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequestInput>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (data: LoginRequestInput) => {
    setServerError(null)
    try {
      const user = await login(data.email, data.password)
      // A super admin goes to the platform console, everyone else to
      // their company's workspace. Uses the returned user rather than
      // the auth context's state, which has not re-rendered yet at this
      // point in the submit handler.
      void navigate(homePathForRole(user.role), { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setServerError(t('error'))
      } else if (err instanceof ApiError && err.status === 429) {
        const seconds = retryAfterSeconds(err.body)
        setServerError(
          seconds === null ? t('tooManyAttempts') : t('tooManyAttemptsFor', { minutes: Math.max(1, Math.ceil(seconds / 60)) }),
        )
      } else if (err instanceof ApiError && err.status === 503) {
        setServerError(t('unavailable'))
      } else {
        throw err
      }
    }
  }

  return (
    <Container className="flex min-h-[70svh] flex-col items-center justify-center py-24">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="mt-2 text-muted-foreground">{t('subhead')}</p>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="mt-8 space-y-5">
          {serverError && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <div>
            <Label htmlFor="email">{t('fields.email.label')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              className="mt-1.5"
              {...register('email')}
            />
            {errors.email && (
              <p id="email-error" role="alert" className="mt-1.5 text-sm text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="password">{t('fields.password.label')}</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              className="mt-1.5"
              {...register('password')}
            />
            {errors.password && (
              <p id="password-error" role="alert" className="mt-1.5 text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {t(isSubmitting ? 'submit.submitting' : 'submit.idle')}
          </Button>
        </form>

        <Link to="/" className="mt-6 block text-center text-sm text-muted-foreground hover:text-foreground">
          {t('backHome')}
        </Link>
      </div>
    </Container>
  )
}

function retryAfterSeconds(body: unknown): number | null {
  if (body && typeof body === 'object' && 'retryAfterSeconds' in body) {
    const value = (body as { retryAfterSeconds?: unknown }).retryAfterSeconds
    if (typeof value === 'number' && value > 0) return value
  }
  return null
}
