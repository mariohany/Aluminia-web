import type { CompanyOverview } from '@repo/types/users'
import type { CompanySubscription } from '@repo/types/subscriptions'
import type { CompanyAlerts } from '@repo/types/alerts'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { apiFetch } from '@/lib/api-client'

export function getCompanyOverview(): Promise<CompanyOverview> {
  return apiFetch<CompanyOverview>('/company/me')
}

export function getCompanySubscription(): Promise<CompanySubscription> {
  return apiFetch<CompanySubscription>('/company/subscription')
}

export function pickFreeProject(projectId: string): Promise<CompanySubscription> {
  return apiFetch<CompanySubscription>('/company/subscription/free-project', { method: 'POST', body: { projectId } })
}

/** What to show now (the expiry bar); also sends a warning email when one
 * is due (docs/subscriptions_planing.md Q2). Called once per app open. */
export function getCompanyAlerts(): Promise<CompanyAlerts> {
  return apiFetch<CompanyAlerts>('/company/alerts')
}

/** Config › Subscription (B24): the company's sent quotations and invoices. */
export function getCompanyBillingDocuments(): Promise<BillingDocumentSummary[]> {
  return apiFetch<BillingDocumentSummary[]>('/company/billing/documents')
}
