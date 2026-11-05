import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpCircle,
  Ban,
  Banknote,
  ChevronDown,
  FileText,
  FilePlus2,
  Mail,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Undo2,
} from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import type { CompanyDetail } from '@repo/types/companies'
import type { BillingDocumentSummary, QuotationPurpose } from '@repo/types/billing-documents'
import { BILLING_TIME_ZONE, subscriptionState } from '@repo/types/subscriptions'
import { useCompanyDocumentsQuery } from '@/lib/billing-queries'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DocumentPdfDialog } from '@/components/billing/document-pdf-dialog'
import { EmailDocumentDialog } from './email-document-dialog'
import { DocumentStatusPill } from '@/components/billing/document-status'
import { MarkPaidDialog } from './mark-paid-dialog'
import { QuotationDialog } from './quotation-dialog'
import { UndoPaymentDialog } from './undo-payment-dialog'
import { VoidQuotationDialog } from './void-quotation-dialog'

/**
 * The company's quotations and invoices on its Billing tab (B19), newest
 * first, with New quotation and each document's actions: its PDF, edit a
 * draft, Mark paid and Void an unpaid one.
 */
export function CompanyDocumentsCard({ company }: { company: CompanyDetail }) {
  const { t, i18n } = useTranslation('admin')
  const { data: documents, isPending, isError } = useCompanyDocumentsQuery(company.id)
  const [editing, setEditing] = useState<{ document?: BillingDocumentSummary; purpose?: QuotationPurpose } | null>(null)
  const [paying, setPaying] = useState<BillingDocumentSummary | null>(null)
  const [viewing, setViewing] = useState<BillingDocumentSummary | null>(null)
  const [voiding, setVoiding] = useState<BillingDocumentSummary | null>(null)
  const [undoing, setUndoing] = useState<BillingDocumentSummary | null>(null)
  const [emailing, setEmailing] = useState<{ document: BillingDocumentSummary; to: string[] } | null>(null)
  const admins = company.users
    .filter((u) => u.role === UserRole.COMPANY_ADMIN && u.status === 'active')
    .map((u) => u.email)
  // Whoever got the quotation gets its invoice; else the company admins.
  const recipientsOf = (doc: BillingDocumentSummary) => {
    const quotation = documents?.find((d) => d.id === doc.quotationId)
    return doc.lastSent?.to ?? quotation?.lastSent?.to ?? admins
  }
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })
  // P30: Free or a trial gets a new subscription; a paid plan its renewal or
  // an upgrade, picked from the button's menu.
  const state = subscriptionState(
    { planKey: company.plan.key, endsAt: company.endsAt, isTrial: company.isTrial },
    new Date(),
  )
  const onPaidPlan = state.kind === 'active' || state.kind === 'ending'
  const endFormatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: BILLING_TIME_ZONE })

  const money = (doc: BillingDocumentSummary) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: doc.currency }).format(doc.totals.total)

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('companyDetail.documents.title')}</CardTitle>
        <CardAction>
          {onPaidPlan && company.endsAt ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <FilePlus2 aria-hidden="true" />
                  {t('quotation.new')}
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={document.documentElement.dir === 'rtl' ? 'start' : 'end'}
                className="w-72 *:data-[slot=dropdown-menu-item]:items-start *:data-[slot=dropdown-menu-item]:gap-2.5 *:data-[slot=dropdown-menu-item]:py-2"
              >
                {(
                  [
                    ['renewal', RefreshCw],
                    ['upgrade', ArrowUpCircle],
                  ] as const
                ).map(([purpose, Icon]) => (
                  <DropdownMenuItem key={purpose} onSelect={() => setEditing({ purpose })}>
                    <Icon className="mt-0.5 text-muted-foreground" aria-hidden="true" />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{t(`quotation.menu.${purpose}`)}</span>
                      <span className="text-xs whitespace-normal text-muted-foreground">
                        {t(`quotation.menu.${purpose}Hint`, { date: endFormatter.format(new Date(company.endsAt!)) })}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" onClick={() => setEditing({ purpose: 'new' })}>
              <FilePlus2 aria-hidden="true" />
              {t('quotation.new')}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="py-6 text-center text-sm text-destructive">{t('documents.loadError')}</p>
        ) : isPending ? null : documents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('companyDetail.documents.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{t('documents.number')}</TableHead>
                <TableHead className="text-xs">{t('documents.status.label')}</TableHead>
                <TableHead className="text-end text-xs">{t('documents.total')}</TableHead>
                <TableHead className="text-xs">{t('documents.created')}</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">{t('usersPage.table.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => {
                const unpaid = doc.kind === 'quotation' && (doc.status === 'draft' || doc.status === 'sent')
                return (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="font-mono text-[13px]">{doc.number}</span>
                        <span className="text-xs text-muted-foreground">{t(`documents.kind.${doc.kind}`)}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-0.5">
                        <DocumentStatusPill status={doc.status} />
                        {doc.lastSent && (
                          <span className="text-xs text-muted-foreground">
                            {t('documents.emailed', {
                              date: dateFormatter.format(new Date(doc.lastSent.at)),
                              count: doc.lastSent.to.length,
                            })}
                          </span>
                        )}
                        {doc.voidReason && (
                          <span className="max-w-56 text-xs break-words text-muted-foreground">{doc.voidReason}</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-end font-mono text-[13px]">
                      {money(doc)}
                      <AmountDifference document={doc} />
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      {dateFormatter.format(new Date(doc.createdAt))}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label={t('usersPage.table.actions')}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-auto min-w-40 whitespace-nowrap">
                          <DropdownMenuItem onSelect={() => setViewing(doc)}>
                            <FileText aria-hidden="true" />
                            {t('documents.actions.pdf')}
                          </DropdownMenuItem>
                          {doc.status !== 'void' && (
                            <DropdownMenuItem onSelect={() => setEmailing({ document: doc, to: recipientsOf(doc) })}>
                              <Mail aria-hidden="true" />
                              {t('documents.actions.email')}
                            </DropdownMenuItem>
                          )}
                          {doc.status === 'draft' && (
                            <DropdownMenuItem onSelect={() => setEditing({ document: doc })}>
                              <Pencil aria-hidden="true" />
                              {t('documents.actions.edit')}
                            </DropdownMenuItem>
                          )}
                          {/* P14: an expired one can still be paid, after a warning. */}
                          {(unpaid || doc.status === 'expired') && (
                            <DropdownMenuItem onSelect={() => setPaying(doc)}>
                              <Banknote aria-hidden="true" />
                              {t('documents.actions.markPaid')}
                            </DropdownMenuItem>
                          )}
                          {/* P22: only today's latest invoice. */}
                          {doc.canUndo && (
                            <DropdownMenuItem variant="destructive" onSelect={() => setUndoing(doc)}>
                              <Undo2 aria-hidden="true" />
                              {t('documents.actions.undo')}
                            </DropdownMenuItem>
                          )}
                          {(unpaid || doc.status === 'expired') && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setVoiding(doc)}
                            >
                              <Ban aria-hidden="true" />
                              {t('documents.actions.void')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <QuotationDialog
        key={editing ? (editing.document?.id ?? editing.purpose ?? 'new') : 'closed'}
        company={company}
        document={editing?.document}
        purpose={editing?.purpose ?? 'new'}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <MarkPaidDialog
        document={paying}
        onOpenChange={(open) => !open && setPaying(null)}
        onEmail={(invoice) => paying && setEmailing({ document: invoice, to: recipientsOf(paying) })}
      />
      <EmailDocumentDialog
        document={emailing?.document ?? null}
        recipients={emailing?.to ?? []}
        onOpenChange={(open) => !open && setEmailing(null)}
      />
      <DocumentPdfDialog document={viewing} onOpenChange={(open) => !open && setViewing(null)} />
      <VoidQuotationDialog document={voiding} onOpenChange={(open) => !open && setVoiding(null)} />
      <UndoPaymentDialog document={undoing} onOpenChange={(open) => !open && setUndoing(null)} />
    </Card>
  )
}

/**
 * P12: an invoice whose money differs from its total shows what arrived and
 * the gap, the note on hover. Super admin only (this card and Transactions).
 */
export function AmountDifference({ document: doc }: { document: BillingDocumentSummary }) {
  const { t, i18n } = useTranslation('admin')
  if (doc.kind !== 'invoice' || doc.amountReceived === null) return null
  const gap = Math.round((doc.amountReceived - doc.totals.total) * 100) / 100
  if (gap === 0) return null
  const format = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: doc.currency })
  return (
    <span
      className="block text-[11px] text-amber-600 dark:text-amber-500"
      title={doc.paymentNote ?? undefined}
    >
      {t('documents.received', {
        amount: format.format(doc.amountReceived),
        gap: `${gap > 0 ? '+' : '−'}${format.format(Math.abs(gap))}`,
      })}
    </span>
  )
}
