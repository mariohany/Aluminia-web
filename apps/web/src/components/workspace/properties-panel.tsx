import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Mail,
  MapPin,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  PencilRuler,
  Phone,
  StickyNote,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ProjectDetail } from '@repo/types/projects'
import type { WindowSummary } from '@repo/types/windows'
import { parseScopedRef } from '@repo/types/company-lookups'
import { useMergedSystemBrandsQuery, useMergedSystemCatalogsQuery } from '@/lib/lookup-merge'
import { useWindowsQuery } from '@/lib/windows-queries'
import { useWindowIssues } from '@/lib/window-render'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const STORAGE_KEY = 'aluminia.workspace.propertiesCollapsed'

/**
 * The project inspector (docs/workspace_redesign_planing.md §3): the
 * selected project's Details, Preferences and the windows that have
 * errors. Collapsible, and it remembers — a panel that springs back
 * open on every navigation is worse than no panel, so the state
 * persists in localStorage.
 *
 * READ-ONLY on purpose. Editing goes through the dialog — one write
 * path per row means validation cannot drift between two surfaces, and
 * an inspector otherwise invites a second inline-editing
 * implementation of the same rules. The section "Edit" links just open
 * that dialog on the matching step.
 */
export function PropertiesPanel({
  project,
  isLoading,
  onEdit,
  onEditPreferences,
  onDelete,
  onOpenWindow,
}: {
  project: ProjectDetail | undefined
  isLoading: boolean
  onEdit: () => void
  onEditPreferences: () => void
  onDelete: () => void
  onOpenWindow: (id: string) => void
}) {
  const { t } = useTranslation('workspace')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // Nothing selected (or a client): no panel at all, rather than an
  // empty frame eating canvas width.
  if (!project && !isLoading) return null

  if (collapsed) {
    // No rail — collapsing gives the canvas that width back entirely.
    // The button floats instead, fixed to the viewport's top end
    // corner, where the panel's own collapse button sat.
    return (
      <Button
        variant="outline"
        size="icon"
        className="fixed end-3 top-3.5 z-10 bg-card shadow-sm"
        aria-label={t('properties.expand')}
        title={t('properties.expand')}
        onClick={() => setCollapsed(false)}
      >
        {/* Mirrors in RTL: the panel is on the other side there, so a
            fixed "right" glyph would point away from it. */}
        <PanelRightOpen className="size-4 rtl:rotate-180" aria-hidden="true" />
      </Button>
    )
  }

  return (
    <aside className="flex w-75 shrink-0 flex-col border-s border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PencilRuler className="size-[17px]" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-snug">
          {project ? (
            <>
              <h2 className="truncate text-sm font-semibold text-foreground" dir="ltr" title={project.enName}>
                {project.enName}
              </h2>
              {project.arName && (
                <span className="max-w-full self-start truncate text-xs text-muted-foreground" dir="rtl">
                  {project.arName}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{t('tree.loading')}</span>
          )}
        </div>
        {project && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7.5"
                aria-label={t('properties.projectActions')}
                title={t('properties.projectActions')}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>{t('actions.editDetails')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onEditPreferences}>{t('actions.editPreferences')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                {t('actions.deleteProject')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7.5"
          aria-label={t('properties.collapse')}
          title={t('properties.collapse')}
          onClick={() => setCollapsed(true)}
        >
          <PanelRightClose className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>

      {project && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Section title={t('properties.details')} onEdit={onEdit}>
              <AddressField project={project} />
              <Field icon={Phone} label={t('fields.phone')} value={project.phone} dir="ltr" mono />
              <Field icon={Mail} label={t('fields.email')} value={project.email} dir="ltr" />
              <Field icon={StickyNote} label={t('fields.notes')} value={project.notes} />
            </Section>
            <PreferencesSection project={project} onEdit={onEditPreferences} />
            <IssuesSection projectId={project.id} onOpenWindow={onOpenWindow} />
          </div>

          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 aria-hidden="true" />
              {t('actions.delete')}
            </Button>
            <Button size="sm" className="ms-auto" onClick={onEdit}>
              <Pencil aria-hidden="true" />
              {t('actions.editProject')}
            </Button>
          </div>
        </>
      )}
    </aside>
  )
}

/** An uppercase caption with an optional "Edit" link, over its fields. */
function Section({
  title,
  onEdit,
  className,
  children,
}: {
  title: string
  onEdit?: () => void
  className?: string
  children: React.ReactNode
}) {
  const { t } = useTranslation('workspace')
  return (
    <section className={className ?? 'flex flex-col gap-3 border-b border-border px-4 py-3.5'}>
      <div className="flex items-center">
        <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="ms-auto rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t('actions.edit')}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** Both languages' site address under one label, each in its own direction. */
function AddressField({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation('workspace')
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel icon={MapPin} label={t('properties.address')} />
      {!project.enAddress && !project.arAddress && <NotSet />}
      {project.enAddress && (
        <p dir="ltr" className="text-[13px] break-words text-foreground">
          {project.enAddress}
        </p>
      )}
      {project.arAddress && (
        <p dir="rtl" className="text-[13px] break-words text-foreground">
          {project.arAddress}
        </p>
      )}
    </div>
  )
}

/**
 * Resolved read-only view of a project's optional defaults — the
 * counterpart to `ProjectPreferencesFields`' edit form. Resolves
 * `defaultSystemBrand`/`defaultSystemCatalog` against the same merged
 * platform+company catalogue the Data page and the edit form both use;
 * a reference that no longer resolves (its target since deleted) shows
 * as "unavailable" rather than blanking silently — the read-side half
 * of docs/project_preferences_planing.md's dangling-reference rule.
 */
function PreferencesSection({ project, onEdit }: { project: ProjectDetail; onEdit: () => void }) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')
  const brands = useMergedSystemBrandsQuery()
  const catalogs = useMergedSystemCatalogsQuery()

  const brand = project.defaultSystemBrand
    ? brands.data?.find((b) => b.id === parseScopedRef(project.defaultSystemBrand!).id)
    : undefined
  const catalog = project.defaultSystemCatalog
    ? catalogs.data?.find((c) => c.id === parseScopedRef(project.defaultSystemCatalog!).id)
    : undefined

  const brandValue = !project.defaultSystemBrand
    ? null
    : brand
      ? `${brand.name} (${brand.scope === 'company' ? tLookups('scope.ours') : tLookups('scope.platform')})`
      : t('properties.unavailable')
  const catalogValue = !project.defaultSystemCatalog
    ? null
    : catalog
      ? `${catalog.name} (${catalog.scope === 'company' ? tLookups('scope.ours') : tLookups('scope.platform')})`
      : t('properties.unavailable')

  const rate = (value: number | null) => (value === null ? null : `${value}%`)

  return (
    <Section title={t('properties.preferencesTitle')} onEdit={onEdit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('fields.defaultSystemBrand')} value={brandValue} />
        <Field label={t('fields.defaultSystemCatalog')} value={catalogValue} />
        <Field label={t('fields.currency')} value={project.currency} dir="ltr" mono />
        <Field label={t('fields.vatRate')} value={rate(project.vatRate)} dir="ltr" mono />
        <Field label={t('fields.discountRate')} value={rate(project.discountRate)} dir="ltr" mono />
      </div>
    </Section>
  )
}

/**
 * The windows that have errors (workspace redesign §3, errors only —
 * the same rule as the red dot on a canvas card). `useWindowIssues` is a
 * hook, so each window gets its own row component; the section hides
 * itself with `has-[]` when none of them rendered anything, rather than
 * lifting every row's result back up into state.
 */
function IssuesSection({ projectId, onOpenWindow }: { projectId: string; onOpenWindow: (id: string) => void }) {
  const { t } = useTranslation('workspace')
  // Same cache as the canvas board — no second request.
  const windowsQuery = useWindowsQuery(projectId)
  const windows = windowsQuery.data ?? []
  if (windows.length === 0) return null

  return (
    <Section
      title={t('properties.issues')}
      className="hidden flex-col gap-2 px-4 py-3.5 has-[[data-issue-row]]:flex"
    >
      <ul className="flex flex-col gap-1.5">
        {windows.map((w) => (
          <WindowIssueRow key={w.id} window={w} onOpen={() => onOpenWindow(w.id)} />
        ))}
      </ul>
    </Section>
  )
}

function WindowIssueRow({ window: w, onOpen }: { window: WindowSummary; onOpen: () => void }) {
  const { t } = useTranslation('workspace')
  const issues = useWindowIssues(w.panels)
  if (issues.length === 0) return null
  const first = issues[0]

  return (
    <li data-issue-row>
      <button
        type="button"
        onClick={onOpen}
        title={t('properties.openWindow')}
        className="flex w-full items-start gap-2.5 rounded-lg bg-destructive/10 p-2.5 text-start outline-none hover:bg-destructive/15 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium text-foreground">{w.name}</span>
          <span className="text-xs text-muted-foreground">
            {t(`windowDialog.design.issues.${first.messageKey}`, first.values)}
            {issues.length > 1 && ` ${t('properties.moreIssues', { count: issues.length - 1 })}`}
          </span>
        </span>
      </button>
    </li>
  )
}

function FieldLabel({ icon: Icon, label }: { icon?: LucideIcon; label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      {Icon && <Icon className="size-3.5" aria-hidden="true" />}
      {label}
    </p>
  )
}

function NotSet() {
  const { t } = useTranslation('workspace')
  // An explicit "not set" rather than a blank line: an empty gap reads
  // as a rendering bug, not as missing data.
  return <p className="text-[13px] text-muted-foreground italic">{t('properties.notSet')}</p>
}

function Field({
  icon,
  label,
  value,
  dir,
  mono = false,
}: {
  icon?: LucideIcon
  label: string
  value: string | null
  dir?: 'ltr' | 'rtl'
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <FieldLabel icon={icon} label={label} />
      {value ? (
        <p dir={dir} className={`text-[13px] break-words text-foreground${mono ? ' font-mono' : ''}`}>
          {value}
        </p>
      ) : (
        <NotSet />
      )}
    </div>
  )
}
