import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ListTree, Star } from 'lucide-react'
import type { ProfileType } from '@repo/types/lookups'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import {
  useMergedSystemBrandsQuery,
  useMergedSystemCatalogsQuery,
  useMergedSystemProfilesQuery,
} from '@/lib/lookup-merge'
import { SearchInput } from '@/components/ui/search-input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'
import { cn } from '@/lib/utils'

/** How many matches a search shows before pointing at Browse. */
const MAX_MATCHES = 8
/** How many of the preferred catalogue's profiles an empty search suggests. */
const MAX_SUGGESTIONS = 5

interface Row {
  ref: ScopedRef
  profileNo: string
  catalogName: string
  brandName: string
  maxGlassThickness: number
}

/**
 * The frame-profile picker as it lives in the inspector since the
 * redesign (docs/window_editor_redesign_planing.md §4): a search box and
 * a short list instead of the always-open brand → catalogue → profile
 * tree. With nothing typed it suggests the favourite, the current pick
 * and a few from the project's preferred catalogue; typing matches the
 * profile number, catalogue or brand. **Browse** opens the full
 * `ProfileTreePicker` in a popover, so nothing the tree could do is lost.
 * Right-click a row → "Set as favourite", same as the tree.
 */
export function ProfileSearchPicker({
  id,
  profileType,
  value,
  onChange,
  favoriteRef,
  onSetFavorite,
  preferredCatalogRef,
  preferredBrandRef,
}: {
  id?: string
  profileType: ProfileType
  value: string | null
  onChange: (ref: ScopedRef) => void
  favoriteRef?: string | null
  onSetFavorite?: (ref: ScopedRef) => void
  preferredCatalogRef?: string | null
  preferredBrandRef?: string | null
}) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')
  const listId = useId()
  const brandsQuery = useMergedSystemBrandsQuery()
  const catalogsQuery = useMergedSystemCatalogsQuery()
  const profilesQuery = useMergedSystemProfilesQuery()

  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [browseOpen, setBrowseOpen] = useState(false)

  // Every profile of this type, flattened with its catalogue/brand names
  // and catalogue/brand refs, sorted by number like the tree.
  const all = useMemo(() => {
    if (!brandsQuery.data || !catalogsQuery.data || !profilesQuery.data) return []
    const brands = new Map(brandsQuery.data.map((b) => [formatScopedRef(b.scope, b.id), b.name]))
    const catalogs = new Map(
      catalogsQuery.data.map((c) => [formatScopedRef(c.scope, c.id), { name: c.name, brand: c.brand }]),
    )
    return profilesQuery.data
      .filter((p) => p.profileType === profileType)
      .map((p) => {
        const catalog = catalogs.get(p.catalog)
        return {
          ref: formatScopedRef(p.scope, p.id),
          profileNo: p.profileNo,
          catalogRef: p.catalog,
          brandRef: catalog?.brand ?? '',
          catalogName: catalog?.name ?? '',
          brandName: (catalog && brands.get(catalog.brand)) ?? '',
          maxGlassThickness: p.maxGlassThickness,
        }
      })
      .sort((a, b) => a.profileNo.localeCompare(b.profileNo))
  }, [brandsQuery.data, catalogsQuery.data, profilesQuery.data, profileType])

  const term = search.trim().toLowerCase()
  const { rows, more } = useMemo(() => {
    if (term) {
      const matches = all.filter(
        (p) =>
          p.profileNo.toLowerCase().includes(term) ||
          p.catalogName.toLowerCase().includes(term) ||
          p.brandName.toLowerCase().includes(term),
      )
      return { rows: matches.slice(0, MAX_MATCHES) as Row[], more: Math.max(0, matches.length - MAX_MATCHES) }
    }
    // Suggestions: favourite, current pick, then the preferred catalogue
    // (or brand) — no duplicates.
    const picked: Row[] = []
    const add = (row: Row | undefined) => {
      if (row && !picked.some((r) => r.ref === row.ref)) picked.push(row)
    }
    add(all.find((p) => p.ref === favoriteRef))
    add(all.find((p) => p.ref === value))
    const preferred = all.filter((p) =>
      preferredCatalogRef ? p.catalogRef === preferredCatalogRef : preferredBrandRef ? p.brandRef === preferredBrandRef : false,
    )
    preferred.slice(0, MAX_SUGGESTIONS).forEach(add)
    return { rows: picked, more: 0 }
  }, [all, term, favoriteRef, value, preferredCatalogRef, preferredBrandRef])

  const activeIndex = Math.min(highlight, Math.max(rows.length - 1, 0))

  const onSearchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter never submits the editor's form from inside the search box,
    // even with no rows to pick.
    if (event.key === 'Enter') event.preventDefault()
    if (rows.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((activeIndex + 1) % rows.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((activeIndex - 1 + rows.length) % rows.length)
    } else if (event.key === 'Enter') {
      onChange(rows[activeIndex].ref)
    }
  }

  const isLoading = brandsQuery.isLoading || catalogsQuery.isLoading || profilesQuery.isLoading
  const isError = brandsQuery.isError || catalogsQuery.isError || profilesQuery.isError

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2" onKeyDown={onSearchKeyDown}>
        <div className="min-w-0 flex-1">
          <SearchInput
            id={id}
            icon
            value={search}
            onChange={(next) => {
              setSearch(next)
              setHighlight(0)
            }}
            placeholder={t('profilePicker.searchPlaceholder')}
            aria-label={t('profilePicker.searchPlaceholder')}
            aria-controls={listId}
            aria-activedescendant={rows.length > 0 ? `${listId}-${activeIndex}` : undefined}
          />
        </div>
        <Popover open={browseOpen} onOpenChange={setBrowseOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5">
              <ListTree className="size-3.5" aria-hidden="true" />
              {t('profilePicker.browse')}
            </Button>
          </PopoverTrigger>
          {/* Radix positions by PHYSICAL side and the app has no
              DirectionProvider, so in RTL (where Browse sits at the
              inspector's left) grow rightward instead — same
              `documentElement.dir` read as add-panel-card.tsx. */}
          <PopoverContent
            align={document.documentElement.dir === 'rtl' ? 'start' : 'end'}
            className="h-[26rem] w-[22rem] p-2"
          >
            <ProfileTreePicker
              profileType={profileType}
              value={value}
              onChange={(ref) => {
                onChange(ref)
                setBrowseOpen(false)
              }}
              favoriteRef={favoriteRef}
              onSetFavorite={onSetFavorite}
              preferredCatalogRef={preferredCatalogRef}
              preferredBrandRef={preferredBrandRef}
            />
          </PopoverContent>
        </Popover>
      </div>

      {isLoading ? (
        <p className="px-1 text-sm text-muted-foreground">{t('profilePicker.loading')}</p>
      ) : isError ? (
        <p className="px-1 text-sm text-destructive">{t('profilePicker.error')}</p>
      ) : rows.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {term ? t('profilePicker.noMatches') : t('profilePicker.typeToSearch')}
        </p>
      ) : (
        <div id={listId} role="listbox" aria-label={t('fields.frameProfile')} className="flex flex-col overflow-hidden rounded-md border border-border">
          {rows.map((row, index) => {
            const isSelected = row.ref === value
            const isFavorite = row.ref === favoriteRef
            const option = (
              <div
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => onChange(row.ref)}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  'flex min-h-10 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-start text-sm',
                  index > 0 && 'border-t border-border',
                  isSelected ? 'bg-primary/10' : index === activeIndex ? 'bg-accent' : '',
                )}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {isFavorite && <Star className="size-3.5 fill-current text-amber-500" aria-label={t('profilePicker.favorite')} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className={cn('truncate', isSelected && 'font-semibold text-primary')}>{row.profileNo}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {row.catalogName}
                    {row.brandName && ` · ${row.brandName}`}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground" dir="ltr" title={tLookups('fields.maxGlassThickness')}>
                  {row.maxGlassThickness}mm
                </span>
                {isSelected && <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />}
              </div>
            )
            if (!onSetFavorite) return <div key={row.ref}>{option}</div>
            return (
              <ContextMenu key={row.ref}>
                <ContextMenuTrigger asChild>{option}</ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onSetFavorite(row.ref)}>{t('profilePicker.setFavorite')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </div>
      )}
      {more > 0 && (
        <p className="px-1 text-xs text-muted-foreground">{t('profilePicker.moreMatches', { count: more })}</p>
      )}
    </div>
  )
}
