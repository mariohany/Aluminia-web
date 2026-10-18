import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, GripVertical, ListChecks, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  PROJECT_STATUS_COLORS,
  type ProjectSettings,
  type ProjectStatus,
  type ProjectStatusColor,
  type UpdateProjectSettingsInput,
} from '@repo/types/project-settings'
import { apiErrorMessage } from '@/lib/api-client'
import { displayName } from '@/lib/bilingual'
import { cn } from '@/lib/utils'
import {
  useProjectSettingsQuery,
  useProjectStatusesQuery,
  useReorderProjectStatusesMutation,
  useUpdateProjectSettingsMutation,
} from '@/lib/project-settings-queries'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfigSectionHeader } from '@/components/workspace/config/config-section-header'
import { ConfigGrid2, ConfigRow, ConfigSaveBar } from '@/components/workspace/config/config-row'
import { ProjectStatusDialog } from '@/components/workspace/config/project-status-dialog'
import { DeleteProjectStatusDialog } from '@/components/workspace/config/delete-project-status-dialog'
import { CurrencySelect, SystemBrandCatalogFields } from '@/components/workspace/system-defaults-fields'
import { ResponsibleAvatars, StatusDot } from '@/components/workspace/status/project-status'

/**
 * Config › Project settings (/workspace/config/projects,
 * docs/project_settings_planing.md §5, board D "card opened · Project
 * settings"): the new-project defaults, with their own Save / Discard
 * (Q5), and the company's project statuses, reordered by dragging (Q1).
 */
export function ConfigProjectsPage() {
  const { t } = useTranslation('workspace')
  return (
    <div className="flex flex-col gap-4 p-4 md:px-9 md:py-6">
      <ConfigSectionHeader title={t('config.sections.projects.title')} />
      <DefaultsCard />
      <StatusesCard />
    </div>
  )
}

type Draft = Required<UpdateProjectSettingsInput>

function toDraft(settings: ProjectSettings): Draft {
  return {
    defaultSystemBrand: settings.defaultSystemBrand,
    defaultSystemCatalog: settings.defaultSystemCatalog,
    currency: settings.currency,
  }
}

function DefaultsCard() {
  const { t } = useTranslation('workspace')
  const settingsQuery = useProjectSettingsQuery()
  const mutation = useUpdateProjectSettingsMutation()
  const settings = settingsQuery.data
  // null = showing the saved values; an edit starts a draft.
  const [draft, setDraft] = useState<Draft | null>(null)

  const saved = settings ? toDraft(settings) : null
  const values = draft ?? saved
  const dirty =
    !!draft &&
    !!saved &&
    (draft.defaultSystemBrand !== saved.defaultSystemBrand ||
      draft.defaultSystemCatalog !== saved.defaultSystemCatalog ||
      draft.currency !== saved.currency)

  const edit = (patch: Partial<Draft>) => values && setDraft({ ...values, ...patch })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft) return
    try {
      await mutation.mutateAsync(draft)
      setDraft(null)
      toast.success(t('config.projects.defaults.saved'))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('config.projects.defaults.saveError')))
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs md:p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
          <ListChecks className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="font-heading text-[17px] font-semibold tracking-tight text-foreground">
            {t('config.projects.defaults.title')}
          </h1>
          <p className="text-[12.5px] text-muted-foreground">{t('config.projects.defaults.hint')}</p>
        </div>
      </div>

      {settingsQuery.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">{t('tree.loading')}</p>}
      {settingsQuery.isError && (
        <p className="py-6 text-center text-sm text-destructive">{t('config.projects.loadError')}</p>
      )}

      {values && (
        <>
          <div className="flex flex-col">
            <ConfigRow title={t('config.projects.defaults.system')} hint={t('config.projects.defaults.systemHint')}>
              <ConfigGrid2>
                <SystemBrandCatalogFields
                  idPrefix="defaults"
                  brand={values.defaultSystemBrand}
                  catalog={values.defaultSystemCatalog}
                  onChange={(next) => edit({ defaultSystemBrand: next.brand, defaultSystemCatalog: next.catalog })}
                />
              </ConfigGrid2>
            </ConfigRow>
            <ConfigRow title={t('config.projects.defaults.currency')} hint={t('config.projects.defaults.currencyHint')}>
              <ConfigGrid2>
                <CurrencySelect
                  id="defaults-currency"
                  value={values.currency}
                  onChange={(currency) => edit({ currency })}
                />
              </ConfigGrid2>
            </ConfigRow>
          </div>
          <ConfigSaveBar dirty={dirty} busy={mutation.isPending} onDiscard={() => setDraft(null)} />
        </>
      )}
    </form>
  )
}

/** The next colour no status uses yet, so a new one stands out. */
function nextColor(statuses: ProjectStatus[]): ProjectStatusColor {
  const used = new Set(statuses.map((status) => status.color))
  return PROJECT_STATUS_COLORS.find((color) => !used.has(color)) ?? 'grey'
}

function StatusesCard() {
  const { t, i18n } = useTranslation('workspace')
  const statusesQuery = useProjectStatusesQuery()
  const reorder = useReorderProjectStatusesMutation()
  const statuses = statusesQuery.data ?? []
  const [editing, setEditing] = useState<{ status: ProjectStatus | null } | null>(null)
  const [deleting, setDeleting] = useState<ProjectStatus | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const needSomeone = statuses.filter((status) => status.responsible.length === 0).length

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = statuses.map((status) => status.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    reorder.mutate(arrayMove(ids, from, to), {
      onError: (err) => toast.error(apiErrorMessage(err, t('config.projects.statuses.reorderError'))),
    })
  }

  return (
    <section
      aria-labelledby="statuses-title"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs md:p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="statuses-title" className="font-heading text-[17px] font-semibold tracking-tight text-foreground">
              {t('config.projects.statuses.title')}
            </h2>
            {needSomeone > 0 && (
              <span className="inline-flex h-5.5 items-center gap-1 rounded-full bg-destructive/10 px-2 text-[11.5px] font-medium text-destructive">
                <AlertTriangle className="size-3" aria-hidden="true" />
                {t('config.projects.statuses.needSomeone', { count: needSomeone })}
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-muted-foreground">{t('config.projects.statuses.hint')}</p>
        </div>
        <Button size="sm" disabled={!statusesQuery.data} onClick={() => setEditing({ status: null })}>
          <Plus className="size-4" aria-hidden="true" />
          {t('config.projects.statuses.add')}
        </Button>
      </div>

      {statusesQuery.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">{t('tree.loading')}</p>}
      {statusesQuery.isError && (
        <p className="py-6 text-center text-sm text-destructive">{t('config.projects.loadError')}</p>
      )}

      {statuses.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[32px_40px_minmax(0,1.4fr)_minmax(0,1.6fr)_110px_40px] items-center gap-2 border-b border-border px-2 pb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <span />
              <span>{t('config.projects.statuses.step')}</span>
              <span>{t('config.projects.statuses.name')}</span>
              <span>{t('config.projects.statuses.responsible')}</span>
              <span>{t('config.projects.statuses.inUse')}</span>
              <span />
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
              accessibility={{
                announcements: {
                  onDragStart: () => '',
                  onDragOver: () => '',
                  onDragCancel: () => '',
                  onDragEnd: ({ active, over }) => {
                    const status = statuses.find((s) => s.id === active.id)
                    const position = statuses.findIndex((s) => s.id === over?.id) + 1
                    return status && position > 0
                      ? t('config.projects.statuses.moved', { name: displayName(status, i18n.language), position })
                      : ''
                  },
                },
              }}
            >
              <SortableContext items={statuses.map((status) => status.id)} strategy={verticalListSortingStrategy}>
                <ol className="flex flex-col">
                  {statuses.map((status) => (
                    <StatusRow
                      key={status.id}
                      status={status}
                      isLast={statuses.length === 1}
                      onEdit={() => setEditing({ status })}
                      onDelete={() => setDeleting(status)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}

      <ProjectStatusDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        status={editing?.status ?? null}
        defaultColor={nextColor(statuses)}
      />
      <DeleteProjectStatusDialog status={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
    </section>
  )
}

function StatusRow({
  status,
  isLast,
  onEdit,
  onDelete,
}: {
  status: ProjectStatus
  isLast: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation('workspace')
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
  })
  const name = displayName(status, i18n.language)
  const nobody = status.responsible.length === 0
  const inUse = status.projectCount > 0
  const deleteBlocked = inUse
    ? t('config.projects.statuses.deleteInUse', { count: status.projectCount })
    : isLast
      ? t('config.projects.statuses.deleteLast')
      : null

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'grid grid-cols-[32px_40px_minmax(0,1.4fr)_minmax(0,1.6fr)_110px_40px] items-center gap-2 border-b border-border px-2 py-2.5 last:border-b-0',
        nobody && 'bg-destructive/5',
        isDragging && 'relative z-10 rounded-lg bg-card shadow-md',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={t('config.projects.statuses.dragHandle', { name })}
        className="flex size-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">{status.position}</span>
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot color={status.color} className="size-2.5" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13.5px] font-medium text-foreground">{name}</span>
          {i18n.language.startsWith('ar') ? (
            <span className="truncate text-[11.5px] text-muted-foreground" dir="ltr">
              {status.enName}
            </span>
          ) : (
            status.arName && (
              <span className="truncate text-[11.5px] text-muted-foreground" dir="rtl">
                {status.arName}
              </span>
            )
          )}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {nobody ? (
          <span className="flex min-w-0 flex-col">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              {t('config.projects.statuses.nobody')}
            </span>
            <span className="truncate text-[11.5px] text-muted-foreground">
              {t('config.projects.statuses.nobodyHint')}
            </span>
          </span>
        ) : (
          <>
            <ResponsibleAvatars users={status.responsible} />
            <span className="min-w-0 truncate text-[12.5px] text-muted-foreground" dir="ltr">
              {status.responsible.map((user) => user.email.split('@')[0]).join(', ')}
            </span>
          </>
        )}
      </span>
      <span className="text-[12.5px] text-muted-foreground">
        {t('config.projects.statuses.projects', { count: status.projectCount })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t('config.projects.statuses.actions')}>
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            {t('config.projects.statuses.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={!!deleteBlocked} onSelect={onDelete}>
            <Trash2 className="size-4" aria-hidden="true" />
            <span className="flex flex-col">
              {t('config.projects.statuses.delete')}
              {deleteBlocked && <span className="text-[11px] text-muted-foreground">{deleteBlocked}</span>}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
