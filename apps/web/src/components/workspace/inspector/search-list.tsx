import { useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SearchInput } from '@/components/ui/search-input'

export interface SearchListItem {
  value: string
  label: string
  /** Muted text after the label — a catalogue, a max thickness. */
  sub?: React.ReactNode
  /** A glyph before the label — an opening icon, a swatch. */
  lead?: React.ReactNode
  /** Extra words the search matches besides the label. */
  keywords?: string
}

export interface SearchListGroup {
  heading?: string
  items: SearchListItem[]
}

/**
 * The body of most inspector pickers — docs/inspector_redesign_planing.md
 * §1: an optional search box, then grouped rows with the picked one
 * ticked. ↑/↓ move, Enter picks (and never submits the editor's form),
 * the search box keeps focus throughout (`aria-activedescendant`).
 */
export function SearchList({
  groups,
  value,
  onPick,
  label,
  searchPlaceholder,
  searchable = true,
  footer,
}: {
  groups: SearchListGroup[]
  value: string | null
  onPick: (value: string) => void
  /** The listbox's accessible name. */
  label: string
  searchPlaceholder?: string
  searchable?: boolean
  footer?: React.ReactNode
}) {
  const { t } = useTranslation('workspace')
  const listId = useId()
  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState(-1)

  const term = search.trim().toLowerCase()
  const shown = groups
    .map((g) => ({
      ...g,
      items: term ? g.items.filter((i) => `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(term)) : g.items,
    }))
    .filter((g) => g.items.length > 0)
  const flat = shown.flatMap((g) => g.items)
  // With nothing highlighted yet, ↓ starts from the picked row.
  const current = highlight >= 0 ? Math.min(highlight, flat.length - 1) : flat.findIndex((i) => i.value === value)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') event.preventDefault()
    if (flat.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((current + 1) % flat.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current - 1 + flat.length) % flat.length)
    } else if (event.key === 'Enter' && current >= 0) {
      onPick(flat[current].value)
    }
  }

  // Each group's first row's place in `flat`, for ids and the highlight.
  const offsets = shown.map((_, g) => shown.slice(0, g).reduce((sum, x) => sum + x.items.length, 0))
  return (
    <div className="flex flex-col gap-1" onKeyDown={onKeyDown}>
      {searchable && (
        <SearchInput
          icon
          value={search}
          onChange={(next) => {
            setSearch(next)
            setHighlight(0)
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          aria-controls={listId}
          aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
        />
      )}
      <div id={listId} role="listbox" aria-label={label} className="flex max-h-[22rem] flex-col overflow-y-auto">
        {flat.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{t('windowDialog.inspector.search.noMatches')}</p>}
        {shown.map((group, g) => (
          <div key={group.heading ?? g} role="group" aria-label={group.heading} className="flex flex-col">
            {group.heading && (
              <span className="px-2 pt-2 pb-0.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.heading}</span>
            )}
            {group.items.map((item, k) => {
              const i = offsets[g] + k
              const selected = item.value === value
              return (
                <div
                  key={item.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => onPick(item.value)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex min-h-8 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-[12.5px]',
                    selected ? 'bg-primary/10 font-medium text-primary' : i === current ? 'bg-accent' : '',
                  )}
                >
                  {item.lead && <span className="flex shrink-0 items-center">{item.lead}</span>}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.sub && <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{item.sub}</span>}
                  {selected && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {footer}
    </div>
  )
}
