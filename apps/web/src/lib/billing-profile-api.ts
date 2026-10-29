import type { BillingProfile, UpdateBillingProfileInput } from '@repo/types/billing-profile'
import { apiFetch } from '@/lib/api-client'

export function getBillingProfile(): Promise<BillingProfile> {
  return apiFetch<BillingProfile>('/admin/billing-profile')
}

export function updateBillingProfile(input: UpdateBillingProfileInput): Promise<BillingProfile> {
  return apiFetch<BillingProfile>('/admin/billing-profile', { method: 'PUT', body: input })
}
