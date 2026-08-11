import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Phone, Trash2 } from 'lucide-react'
import type { LeadSummary } from '@repo/types/leads'
import { useLeadsQuery, useMarkLeadContactedMutation } from '@/lib/leads-queries'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DeleteLeadDialog } from '@/components/admin/leads/delete-lead-dialog'
import { DeleteSelectedLeadsDialog } from '@/components/admin/leads/delete-selected-leads-dialog'

// tel: needs just digits and a leading +; the stored value keeps
// whatever punctuation the visitor typed (quoteRequestSchema allows
// spaces, parens, dashes) for display, so it's stripped here rather
// than at the point of capture.
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

export function LeadsList() {
  const { t, i18n } = useTranslation('admin')
  const { data, isLoading, isError } = useLeadsQuery()
  const markContacted = useMarkLeadContactedMutation()
  const [deleteTarget, setDeleteTarget] = useState<LeadSummary | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const leads = data ?? []
  // Selection can only ever reference rows that still exist — filtered
  // on every render rather than reconciled in an effect, so a delete
  // (single-row or bulk) can never leave a stale id selected. Plain
  // computation rather than useMemo: the list is small (an admin
  // dashboard's leads, not a paginated table), so there's nothing here
  // worth the extra dependency array.
  const selectedIds = leads.map((lead) => lead.id).filter((id) => selected.has(id))
  const allSelected = leads.length > 0 && selectedIds.length === leads.length
  const someSelected = selectedIds.length > 0 && !allSelected

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(leads.map((lead) => lead.id)) : new Set())
  }

  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t('leadsSection.title')}</CardTitle>
        {selectedIds.length > 0 && (
          <DeleteSelectedLeadsDialog ids={selectedIds} onDeleted={() => setSelected(new Set())} />
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : isError ? (
          <p className="text-sm text-destructive">{t('leadsSection.error')}</p>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('leadsSection.empty')}</p>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={(checked) => toggleAll(checked === true)}
                      aria-label={t('leadsSection.selectAll')}
                    />
                  </TableHead>
                  <TableHead>{t('leadsSection.table.company')}</TableHead>
                  <TableHead>{t('leadsSection.table.requester')}</TableHead>
                  <TableHead>{t('leadsSection.table.phone')}</TableHead>
                  <TableHead>{t('leadsSection.table.status')}</TableHead>
                  <TableHead>{t('leadsSection.table.received')}</TableHead>
                  <TableHead className="w-10 sr-only">{t('leadsSection.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => {
                  const contacted = lead.contactedAt !== null
                  return (
                    <TableRow key={lead.id} className={cn(contacted && 'bg-secondary/40')}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(lead.id)}
                          onCheckedChange={(checked) => toggleRow(lead.id, checked === true)}
                          aria-label={t('leadsSection.selectRow', { name: lead.companyName })}
                        />
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{lead.companyName}</TableCell>
                      <TableCell>{lead.requesterName}</TableCell>
                      <TableCell>
                        <a
                          href={telHref(lead.phone)}
                          dir="ltr"
                          className="inline-flex items-center gap-1.5 text-foreground hover:underline"
                          onClick={() => markContacted.mutate(lead.id)}
                        >
                          <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                          {lead.phone}
                        </a>
                      </TableCell>
                      <TableCell>
                        {contacted ? (
                          <Badge variant="secondary">{t('leadsSection.calledBadge')}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {dateTimeFormatter.format(new Date(lead.createdAt))}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('leadsSection.deleteRow')}
                          onClick={() => setDeleteTarget(lead)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <DeleteLeadDialog
        lead={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null)
        }}
      />
    </Card>
  )
}
