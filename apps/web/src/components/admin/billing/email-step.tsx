import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Eye, FileText, Send, X } from 'lucide-react'
import { z } from 'zod'
import type { BillingDocumentSummary } from '@repo/types/billing-documents'
import { apiErrorCode, apiErrorMessage } from '@/lib/api-client'
import { useSendDocumentMutation } from '@/lib/billing-queries'
import { billingPdfFileName, useBillingPdf } from '@/lib/billing-pdf'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DialogFooter } from '@/components/ui/dialog'
import { DocumentPdfDialog } from './document-pdf-dialog'

const isEmail = (value: string) => z.email().safeParse(value).success

async function toBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the PDF.'))
    reader.readAsDataURL(blob)
  })
  return url.slice(url.indexOf(',') + 1)
}

/**
 * The Email step (docs/subscriptions_planing.md B16, B18, board
 * `bill-q-send`): To as chips (the company admins prefilled), subject,
 * Send me a copy, and the attached PDF with an eye to preview it. The PDF
 * is drawn here and sent along; the server only attaches it (Q1).
 */
export function EmailStep({
  document,
  recipients,
  subject: defaultSubject,
  onBack,
  onCancel,
  onSent,
}: {
  document: BillingDocumentSummary
  recipients: string[]
  subject: string
  onBack?: () => void
  onCancel: () => void
  onSent: (document: BillingDocumentSummary) => void
}) {
  const { t } = useTranslation('admin')
  const [to, setTo] = useState<string[]>(recipients)
  const [draft, setDraft] = useState('')
  const [subject, setSubject] = useState(defaultSubject)
  const [copyMe, setCopyMe] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const { pdf, isError } = useBillingPdf(document)
  const send = useSendDocumentMutation()
  const draftInvalid = draft.trim() !== '' && !isEmail(draft.trim())

  function addDraft(): boolean {
    const email = draft.trim().replace(/[,;]$/, '')
    if (!email) return true
    if (!isEmail(email)) return false
    if (!to.includes(email.toLowerCase())) setTo([...to, email.toLowerCase()])
    setDraft('')
    return true
  }

  async function submit() {
    if (!addDraft() || !pdf) return
    const recipientsNow = draft.trim() ? [...to, draft.trim().toLowerCase()] : to
    if (recipientsNow.length === 0) return
    try {
      const sent = await send.mutateAsync({
        id: document.id,
        input: { to: recipientsNow, subject: subject.trim(), copyMe, pdfBase64: await toBase64(pdf) },
      })
      toast.success(t('email.sent', { number: document.number, count: recipientsNow.length }))
      onSent(sent)
    } catch (err) {
      toast.error(
        apiErrorCode(err) === 'mail_failed' ? t('email.failed') : apiErrorMessage(err, t('email.error')),
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email-to">{t('email.to')}</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 focus-within:ring-[3px] focus-within:ring-ring/50">
          {to.map((email) => (
            <span key={email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[13px]">
              {email}
              <button
                type="button"
                aria-label={t('email.remove', { email })}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setTo(to.filter((e) => e !== email))}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            id="email-to"
            type="email"
            value={draft}
            placeholder={to.length ? '' : t('email.toPlaceholder')}
            aria-invalid={draftInvalid}
            className="min-w-40 flex-1 bg-transparent py-0.5 text-sm outline-none"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                e.preventDefault()
                addDraft()
              } else if (e.key === 'Backspace' && draft === '' && to.length) {
                setTo(to.slice(0, -1))
              }
            }}
            onBlur={() => addDraft()}
          />
        </div>
        <p className={draftInvalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {draftInvalid ? t('email.invalid') : t('email.toHint')}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email-subject">{t('email.subject')}</Label>
        <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={copyMe} onCheckedChange={(checked) => setCopyMe(checked === true)} />
        {t('email.copyMe')}
      </label>

      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
        <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[13px]">{billingPdfFileName(document)}</span>
          <span className="text-xs text-muted-foreground">
            {pdf ? t('email.attachment', { size: Math.max(1, Math.round(pdf.size / 1024)) }) : isError ? t('documents.pdf.error') : t('documents.pdf.drawing')}
          </span>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t('email.preview')} disabled={!pdf} onClick={() => setPreviewing(true)}>
          <Eye aria-hidden="true" />
        </Button>
      </div>

      <DialogFooter>
        {onBack && (
          <Button type="button" variant="ghost" className="sm:me-auto" onClick={onBack}>
            {t('email.back')}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('quotation.cancel')}
        </Button>
        <Button
          type="button"
          disabled={!pdf || send.isPending || (to.length === 0 && !draft.trim()) || !subject.trim()}
          onClick={() => void submit()}
        >
          <Send aria-hidden="true" />
          {t('email.send')}
        </Button>
      </DialogFooter>

      <DocumentPdfDialog document={previewing ? document : null} onOpenChange={(open) => !open && setPreviewing(false)} />
    </div>
  )
}
