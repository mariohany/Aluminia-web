import { useTranslation } from 'react-i18next'
import type { DocumentStatus } from '@repo/types/billing-documents'
import { cn } from '@/lib/utils'

const TONES: Record<DocumentStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-primary/10 text-primary',
  expired: 'bg-destructive/10 text-destructive',
  paid: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  void: 'bg-muted text-muted-foreground line-through',
}

/** A quotation's or invoice's status as a small pill. */
export function DocumentStatusPill({ status }: { status: DocumentStatus }) {
  const { t } = useTranslation('admin')
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium', TONES[status])}>
      {t(`documents.status.${status}`)}
    </span>
  )
}
