import { createContext, useContext } from 'react'
import { missingProfileFields } from '@repo/types/company-profile'
import { useCompanyProfileQuery } from '@/lib/company-profile-queries'

/**
 * Is the company profile complete enough to print (docs/subscriptions_planing.md
 * B23)? Until it is, nothing makes or shows a PDF; every page still works
 * (Mario 2026-10-28). Reads as complete while the profile loads, so
 * nothing flashes locked. The API is the real gate (`profile_incomplete`).
 */
export function useProfileGate() {
  const { data } = useCompanyProfileQuery()
  const missing = data ? missingProfileFields(data) : []
  return { loaded: !!data, missing, complete: missing.length === 0 }
}

/** Opens the "complete the company profile" dialog (admin) or the
 * "contact your company admin" one (plain user). */
export const ProfileRequiredContext = createContext<() => void>(() => {})

export function useProfileRequired() {
  return useContext(ProfileRequiredContext)
}
