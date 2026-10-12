import { useState } from 'react'
import { Collapsible } from 'radix-ui'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// Which groups the user folded, per browser — a convenience only, so
// every read/write is guarded (private windows, blocked storage).
const STORAGE_KEY = 'aluminia.inspector.groups'

function readOpen(id: string): boolean | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const saved = raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    return typeof saved[id] === 'boolean' ? saved[id] : undefined
  } catch {
    return undefined
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const saved = raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, [id]: open }))
  } catch {
    // Storage unavailable — the group still folds for this visit.
  }
}

/**
 * One block of the property sheet — docs/inspector_redesign_planing.md
 * §1: an uppercase heading that folds the block, an optional right slot
 * (a count, a link icon), and its rows. `id` names the group across
 * selections (`section.glass`), so folding Glass once keeps it folded
 * on every section. A group with no `title` is a plain, unfoldable
 * block (the panel's issues + delete line).
 */
export function PropertyGroup({
  id,
  title,
  right,
  defaultOpen = true,
  first = false,
  children,
}: {
  id: string
  title?: string
  right?: React.ReactNode
  defaultOpen?: boolean
  /** The first group under the header has no top border. */
  first?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(() => readOpen(id) ?? defaultOpen)
  const border = first ? '' : 'border-t border-border'

  if (!title) return <div className={cn('flex flex-col gap-1 px-4 py-2.5', border)}>{children}</div>

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        writeOpen(id, next)
      }}
      className={cn('px-4 py-2.5', border)}
    >
      <div className="flex items-center gap-2">
        <Collapsible.Trigger className="-ms-1 flex h-7 flex-1 items-center gap-1.5 rounded-md px-1 text-start text-[11px] font-semibold tracking-wider text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90 rtl:rotate-90')} aria-hidden="true" />
          {title}
        </Collapsible.Trigger>
        {right && <span className="flex items-center text-xs text-muted-foreground">{right}</span>}
      </div>
      <Collapsible.Content className="flex flex-col gap-1 pt-1">{children}</Collapsible.Content>
    </Collapsible.Root>
  )
}
