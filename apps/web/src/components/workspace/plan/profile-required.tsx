import { useCallback, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Building2 } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import { useAuth } from '@/lib/auth-context'
import { useCompanyOverviewQuery } from '@/lib/company-queries'
import { ProfileRequiredContext, useProfileGate } from '@/lib/profile-gate'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const PROFILE_PATH = '/workspace/config/company'

/**
 * The company profile must be complete before anything prints (B23). On
 * each workspace open (once per page load) the company admin is reminded,
 * with what's missing and a way straight to Config › Company profile, and
 * a plain user is told to contact the admin. Both can close it: every page
 * still works, only PDFs wait (Mario 2026-10-28). Never shown on the
 * profile page itself; Generate and opening a report show it again.
 */
export function ProfileRequiredProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('workspace')
  const { user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const gate = useProfileGate()
  const { data: company } = useCompanyOverviewQuery()
  const isAdmin = user?.role === UserRole.COMPANY_ADMIN
  const [open, setOpen] = useState(false)
  const show = useCallback(() => setOpen(true), [])

  // Decided once, the first time the profile is known (state adjusted
  // during render, not in an effect).
  const [reminded, setReminded] = useState(false)
  if (!reminded && gate.loaded) {
    setReminded(true)
    if (!gate.complete && pathname !== PROFILE_PATH) setOpen(true)
  }

  // Filled in meanwhile (another tab, or this admin on the profile page).
  const visible = open && !gate.complete

  return (
    <ProfileRequiredContext.Provider value={show}>
      {children}
      <Dialog open={visible} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Building2 className="size-5" aria-hidden="true" />
            </span>
            <DialogTitle>{t(isAdmin ? 'profileRequired.adminTitle' : 'profileRequired.userTitle')}</DialogTitle>
            <DialogDescription>
              {isAdmin
                ? t('profileRequired.adminBody')
                : company?.adminEmail
                  ? t('profileRequired.userBody', { email: company.adminEmail })
                  : t('profileRequired.userBodyNoAdmin')}
            </DialogDescription>
          </DialogHeader>
          {isAdmin && (
            <ul className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-sm">
              {gate.missing.map((field) => (
                <li key={field} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-destructive" />
                  {t(`profileRequired.fields.${field}`)}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant={isAdmin ? 'ghost' : 'default'} onClick={() => setOpen(false)}>
              {t(isAdmin ? 'profileRequired.later' : 'profileRequired.ok')}
            </Button>
            {isAdmin && pathname !== PROFILE_PATH && (
              <Button
                onClick={() => {
                  setOpen(false)
                  void navigate(PROFILE_PATH)
                }}
              >
                {t('profileRequired.goToProfile')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProfileRequiredContext.Provider>
  )
}
