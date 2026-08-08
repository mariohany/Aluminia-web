import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRightClose, PanelRightOpen, Pencil, Trash2 } from 'lucide-react'
import type { ProjectDetail } from '@repo/types/projects'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'aluminia.workspace.propertiesCollapsed'

/**
 * The selected project's fields, Figma-style: collapsible, and it
 * remembers. A panel that springs back open on every navigation is
 * worse than no panel, so the state persists in localStorage.
 *
 * READ-ONLY on purpose. Editing goes through the dialog — one write
 * path per row means validation cannot drift between two surfaces, and
 * "properties panel" otherwise invites a second inline-editing
 * implementation of the same rules.
 */
export function PropertiesPanel({
  project,
  isLoading,
  onEdit,
  onDelete,
}: {
  project: ProjectDetail | undefined
  isLoading: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('workspace')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // Nothing selected: no panel at all, rather than an empty frame
  // eating canvas width.
  if (!project && !isLoading) return null

  if (collapsed) {
    return (
      <div className="shrink-0 border-s border-border p-2">
        <Button variant="ghost" size="icon" aria-label={t('properties.expand')} onClick={() => setCollapsed(false)}>
          {/* Mirrors in RTL: the panel is on the other side there, so a
              fixed "right" glyph would point away from it. */}
          <PanelRightOpen className="size-5 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <aside className={cn('w-72 shrink-0 overflow-y-auto border-s border-border bg-background')}>
      <div className="flex items-center justify-between gap-2 p-3">
        <h2 className="text-sm font-semibold text-foreground">{t('properties.title')}</h2>
        <Button variant="ghost" size="icon" aria-label={t('properties.collapse')} onClick={() => setCollapsed(true)}>
          <PanelRightClose className="size-5 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
      <Separator />

      {isLoading || !project ? (
        <p className="p-3 text-sm text-muted-foreground">{t('tree.loading')}</p>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <Field label={t('fields.enName')} value={project.enName} dir="ltr" />
          <Field label={t('fields.arName')} value={project.arName} dir="rtl" />
          <Field label={t('fields.enAddress')} value={project.enAddress} dir="ltr" />
          <Field label={t('fields.arAddress')} value={project.arAddress} dir="rtl" />
          <Field label={t('fields.phone')} value={project.phone} dir="ltr" />
          <Field label={t('fields.email')} value={project.email} dir="ltr" />
          <Field label={t('fields.notes')} value={project.notes} />

          <Separator />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              {t('actions.edit')}
            </Button>
            <Button variant="outline" size="sm" className="text-destructive" aria-label={t('actions.delete')} onClick={onDelete}>
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </aside>
  )
}

function Field({ label, value, dir }: { label: string; value: string | null; dir?: 'ltr' | 'rtl' }) {
  const { t } = useTranslation('workspace')
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {value ? (
        <p dir={dir} className="mt-0.5 break-words text-sm text-foreground">
          {value}
        </p>
      ) : (
        // An explicit "not set" rather than a blank line: an empty gap
        // reads as a rendering bug, not as missing data.
        <p className="mt-0.5 text-sm italic text-muted-foreground">{t('properties.notSet')}</p>
      )}
    </div>
  )
}
