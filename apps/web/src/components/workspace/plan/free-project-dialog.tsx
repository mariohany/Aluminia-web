import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ClientWithProjects } from '@repo/types/clients'
import { apiErrorMessage } from '@/lib/api-client'
import { displayName } from '@/lib/bilingual'
import { usePickFreeProjectMutation } from '@/lib/company-queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Free keeps ONE project editable (docs/subscriptions_planing.md B13): the
 * company admin picks it here, once; the rest stay viewable and
 * deletable. "Later" leaves every project read-only until then, and the
 * dialog comes back the next time the workspace opens.
 */
export function FreeProjectDialog({ clients }: { clients: ClientWithProjects[] }) {
  const { t, i18n } = useTranslation('workspace')
  const language = i18n.resolvedLanguage ?? 'en'
  const [open, setOpen] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  const mutation = usePickFreeProjectMutation()

  const pick = async () => {
    if (!picked) return
    try {
      await mutation.mutateAsync(picked)
      toast.success(t('plan.pick.saved'))
      setOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('plan.pick.error')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('plan.pick.title')}</DialogTitle>
          <DialogDescription>{t('plan.pick.body')}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label={t('plan.pick.title')} className="flex flex-col gap-3">
          {clients
            .filter((client) => client.projects.length > 0)
            .map((client) => (
              <div key={client.id} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{displayName(client, language)}</span>
                {client.projects.map((project) => {
                  const on = picked === project.id
                  return (
                    <button
                      key={project.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setPicked(project.id)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-start text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        on ? 'border-primary bg-primary/5 font-medium text-foreground' : 'border-border hover:bg-accent',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-full border',
                          on ? 'border-primary' : 'border-input',
                        )}
                        aria-hidden="true"
                      >
                        {on && <span className="size-2 rounded-full bg-primary" />}
                      </span>
                      {displayName(project, language)}
                    </button>
                  )
                })}
              </div>
            ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('plan.pick.once')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('plan.pick.later')}
          </Button>
          <Button disabled={!picked || mutation.isPending} onClick={() => void pick()}>
            {t('plan.pick.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
