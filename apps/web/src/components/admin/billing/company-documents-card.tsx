import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Ban, Banknote, FileText, FilePlus2, Mail, MoreHorizontal, Pencil } from 'lucide-react'
import { UserRole } from '@repo/types/auth'
import type { CompanyDetail } from '@repo/types/companies'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { apiErrorMessage } from '@/lib/api-client'
import { useCompanyDocumentsQuery, useVoidQuotationMutation } from '@/lib/billing-queries'
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

/**
 * The company's quotations and invoices on its Billing tab (B19), newest
 * first, with New quotation and each document's actions: its PDF, edit a
 * draft, Mark paid and Void an unpaid one.
 */
export function CompanyDocumentsCard({ company }: { company: CompanyDetail }) {
  const { t, i18n } = useTranslation('admin')
  const { data: documents, isPending, isError } = useCompanyDocumentsQuery(company.id)
  const voidMutation = useVoidQuotationMutation()
  const [editing, setEditing] = useState<{ document?: BillingDocumentSummary } | null>(null)
  const [paying, setPaying] = useState<BillingDocumentSummary | null>(null)
  const [viewing, setViewing] = useState<BillingDocumentSummary | null>(null)
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

  const money = (doc: BillingDocumentSummary) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: doc.currency }).format(doc.totals.total)

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('companyDetail.documents.title')}</CardTitle>
        <CardAction>
          <Button size="sm" onClick={() => setEditing({})}>
            <FilePlus2 aria-hidden="true" />
            {t('quotation.new')}
          </Button>
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
                      </span>
                    </TableCell>
                    <TableCell className="text-end font-mono text-[13px]">{money(doc)}</TableCell>
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
                        <DropdownMenuContent align="end">
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
                          {unpaid && (
                            <DropdownMenuItem onSelect={() => setPaying(doc)}>
                              <Banknote aria-hidden="true" />
                              {t('documents.actions.markPaid')}
                            </DropdownMenuItem>
                          )}
                          {(unpaid || doc.status === 'expired') && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                voidMutation.mutate(doc.id, {
                                  onSuccess: () => toast.success(t('documents.actions.voided', { number: doc.number })),
                                  onError: (err) => toast.error(apiErrorMessage(err, t('documents.actions.error'))),
                                })
                              }
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
        key={editing ? (editing.document?.id ?? 'new') : 'closed'}
        company={company}
        document={editing?.document}
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
    </Card>
  )
}
