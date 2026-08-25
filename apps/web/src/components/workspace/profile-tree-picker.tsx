import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Star } from 'lucide-react'
import type { ProfileType } from '@repo/types/lookups'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import {
  useMergedSystemBrandsQuery,
  useMergedSystemCatalogsQuery,
  useMergedSystemProfilesQuery,
  type MergedSystemBrandSummary,
  type MergedSystemCatalogSummary,
  type MergedSystemProfileSummary,
} from '@/lib/lookup-merge'
import { SearchInput } from '@/components/ui/search-input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'

interface CatalogNode extends MergedSystemCatalogSummary {
  ref: ScopedRef
  profiles: MergedSystemProfileSummary[]
}

interface BrandNode extends MergedSystemBrandSummary {
  ref: ScopedRef
  catalogs: CatalogNode[]
}

interface ProfileTreePickerProps {
  profileType: ProfileType
  value: string | null
  onChange: (ref: ScopedRef) => void
  /** The starred row. Marked only — doesn't affect order or expansion. */
  favoriteRef?: string | null
  /** Right-click → "Set as favourite" on a profile row. Omit to disable. */
  onSetFavorite?: (ref: ScopedRef) => void
  /**
   * The project's default catalogue/brand — seeds the search bar (once,
   * when the data needed to resolve a name has loaded) with that row's
   * own name, exactly as if the user had typed it. This narrows the
   * tree through the same search/filter every other search does — not
   * a separate hard filter over the data — so clearing the search bar
   * still shows everything.
   */
  preferredCatalogRef?: string | null
  preferredBrandRef?: string | null
}

/**
 * Searchable brand → catalogue → profile tree, filtered to one
 * `profileType`. Styled and behaved like `project-tree.tsx` — a
 * persistent left-hand panel, not a boxed dropdown-like list: no
 * border, fills the height it's given, everything collapsed by default
 * except whatever the search term currently matches.
 *
 * Unlike `ProjectTree`, this isn't router-driven navigation: rows are
 * plain buttons and selection is fully controlled via `value`/
 * `onChange`, so the same tree can be embedded in a dialog.
 */
export function ProfileTreePicker({
  profileType,
  value,
  onChange,
  favoriteRef,
  onSetFavorite,
  preferredCatalogRef,
  preferredBrandRef,
}: ProfileTreePickerProps) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')

  const brandsQuery = useMergedSystemBrandsQuery()
  const catalogsQuery = useMergedSystemCatalogsQuery()
  const profilesQuery = useMergedSystemProfilesQuery()

  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const treeRef = useRef<HTMLDivElement>(null)
  const seededSearch = useRef(false)

  // Seed the search bar once, as soon as the data needed to resolve a
  // name is loaded — a catalogue's own name wins over the brand's if
  // both are set, since it's the more specific default. This never
  // fires again after the first successful (or empty) attempt, so it
  // doesn't fight a user who's already typed their own search term.
  useEffect(() => {
    if (seededSearch.current) return
    if (!brandsQuery.data || !catalogsQuery.data) return
    seededSearch.current = true
    const catalogName = preferredCatalogRef
      ? catalogsQuery.data.find((c) => formatScopedRef(c.scope, c.id) === preferredCatalogRef)?.name
      : undefined
    const brandName = preferredBrandRef
      ? brandsQuery.data.find((b) => formatScopedRef(b.scope, b.id) === preferredBrandRef)?.name
      : undefined
    const name = catalogName ?? brandName
    if (name) setSearch(name)
  }, [brandsQuery.data, catalogsQuery.data, preferredCatalogRef, preferredBrandRef])

  const isLoading = brandsQuery.isLoading || catalogsQuery.isLoading || profilesQuery.isLoading
  const isError = brandsQuery.isError || catalogsQuery.isError || profilesQuery.isError

  // Three-level tree, built once per data change — catalogues with no
  // profile of this type, and brands with no such catalogue, are
  // dropped entirely rather than shown empty. Profiles sort by number
  // only — a favourite is marked with a star, never reordered.
  const tree = useMemo<BrandNode[]>(() => {
    if (!brandsQuery.data || !catalogsQuery.data || !profilesQuery.data) return []

    const profilesByCatalog = new Map<string, MergedSystemProfileSummary[]>()
    for (const profile of profilesQuery.data) {
      if (profile.profileType !== profileType) continue
      const list = profilesByCatalog.get(profile.catalog) ?? []
      list.push(profile)
      profilesByCatalog.set(profile.catalog, list)
    }
    for (const list of profilesByCatalog.values()) {
      list.sort((a, b) => a.profileNo.localeCompare(b.profileNo))
    }

    const catalogsByBrand = new Map<string, CatalogNode[]>()
    for (const catalog of catalogsQuery.data) {
      const profiles = profilesByCatalog.get(formatScopedRef(catalog.scope, catalog.id))
      if (!profiles || profiles.length === 0) continue
      const list = catalogsByBrand.get(catalog.brand) ?? []
      list.push({ ...catalog, ref: formatScopedRef(catalog.scope, catalog.id), profiles })
      catalogsByBrand.set(catalog.brand, list)
    }
    for (const list of catalogsByBrand.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }

    const brands: BrandNode[] = []
    for (const brand of brandsQuery.data) {
      const catalogs = catalogsByBrand.get(formatScopedRef(brand.scope, brand.id))
      if (!catalogs || catalogs.length === 0) continue
      brands.push({ ...brand, ref: formatScopedRef(brand.scope, brand.id), catalogs })
    }
    brands.sort((a, b) => a.name.localeCompare(b.name))
    return brands
  }, [brandsQuery.data, catalogsQuery.data, profilesQuery.data, profileType])

  // Same cascading match as ProjectTree: a matching brand or catalogue
  // keeps all its children, otherwise children are filtered on their
  // own name/number.
  const term = search.trim().toLowerCase()
  const searching = term.length > 0
  const filtered = useMemo(() => {
    if (!term) return tree

    const matches = (v: string) => v.toLowerCase().includes(term)

    return tree
      .map((brand) => {
        const brandMatches = matches(brand.name)
        const catalogs = brand.catalogs
          .map((catalog) => {
            const catalogMatches = brandMatches || matches(catalog.name)
            const profiles = catalogMatches
              ? catalog.profiles
              : catalog.profiles.filter((p) => matches(p.profileNo))
            return { ...catalog, profiles }
          })
          .filter((catalog) => catalog.profiles.length > 0)
        return { ...brand, catalogs }
      })
      .filter((brand) => brand.catalogs.length > 0)
  }, [tree, term])

  // Which brand/catalogue owns the selected profile — the catalogue's
  // row carries a check mark for it (the only way to tell where the
  // selection lives while collapsed), and both get auto-expanded once
  // below so the selection is visible without the user searching for it.
  const selectedLocation = useMemo(() => {
    if (!value) return null
    for (const brand of tree) {
      for (const catalog of brand.catalogs) {
        if (catalog.profiles.some((p) => formatScopedRef(p.scope, p.id) === value)) {
          return { brandRef: brand.ref, catalogRef: catalog.ref }
        }
      }
    }
    return null
  }, [tree, value])
  const selectedCatalogRef = selectedLocation?.catalogRef ?? null

  // Fires once per mount, as soon as the tree is built and a selected
  // value resolves to a location — covers both a window opened for
  // edit (its frame is already set) and create-mode's favourite-frame
  // prefill. A value picked live by clicking a row needs no help: its
  // catalogue is already expanded, or the user couldn't have clicked it.
  const expandedSelection = useRef(false)
  useEffect(() => {
    if (expandedSelection.current) return
    if (!selectedLocation) return
    expandedSelection.current = true
    setCollapsed((prev) => ({ ...prev, [selectedLocation.brandRef]: false, [selectedLocation.catalogRef]: false }))
  }, [selectedLocation])

  const focusAdjacentRow = (current: HTMLElement, delta: 1 | -1) => {
    const rows = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? [])
    const next = rows[rows.indexOf(current) + delta]
    next?.focus()
  }

  if (isLoading) {
    return <p className="p-2 text-sm text-muted-foreground">{t('profilePicker.loading')}</p>
  }
  if (isError) {
    return <p className="p-2 text-sm text-destructive">{t('profilePicker.error')}</p>
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-2">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('profilePicker.searchPlaceholder')}
        aria-label={t('profilePicker.searchPlaceholder')}
      />

      {tree.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{t('profilePicker.empty')}</p>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{t('profilePicker.noMatches')}</p>
      ) : (
        <div ref={treeRef} role="tree" className="-mx-1 flex-1 overflow-x-hidden overflow-y-auto">
          {filtered.map((brand) => {
            // Collapsed by default — everything opens only via search
            // (which bypasses this entirely) or an explicit click.
            const brandCollapsed = !searching && (collapsed[brand.ref] ?? true)
            const toggleBrand = () =>
              setCollapsed((prev) => ({ ...prev, [brand.ref]: !(prev[brand.ref] ?? true) }))
            return (
              <div key={brand.ref} role="treeitem" aria-expanded={!brandCollapsed}>
                <div
                  className="flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium hover:bg-accent"
                  onDoubleClick={toggleBrand}
                >
                  <button
                    type="button"
                    onClick={toggleBrand}
                    className="flex shrink-0 items-center rounded-md p-1"
                    aria-label={brandCollapsed ? t('tree.expand') : t('tree.collapse')}
                  >
                    {brandCollapsed ? (
                      <ChevronRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={toggleBrand}
                    data-tree-row
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        focusAdjacentRow(event.currentTarget, 1)
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        focusAdjacentRow(event.currentTarget, -1)
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center truncate py-0.5 text-start"
                  >
                    <span className="truncate">{brand.name}</span>
                  </button>
                </div>

                {!brandCollapsed && (
                  <div role="group">
                    {brand.catalogs.map((catalog) => {
                      const catalogCollapsed = !searching && (collapsed[catalog.ref] ?? true)
                      const toggleCatalog = () =>
                        setCollapsed((prev) => ({ ...prev, [catalog.ref]: !(prev[catalog.ref] ?? true) }))
                      return (
                        <div key={catalog.ref} role="treeitem" aria-expanded={!catalogCollapsed}>
                          <div
                            className="flex items-center gap-1 rounded-md ps-6 pe-1 py-1 text-sm hover:bg-accent"
                            onDoubleClick={toggleCatalog}
                          >
                            <button
                              type="button"
                              onClick={toggleCatalog}
                              className="flex shrink-0 items-center rounded-md p-1"
                              aria-label={catalogCollapsed ? t('tree.expand') : t('tree.collapse')}
                            >
                              {catalogCollapsed ? (
                                <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden="true" />
                              ) : (
                                <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={toggleCatalog}
                              data-tree-row
                              onKeyDown={(event) => {
                                if (event.key === 'ArrowDown') {
                                  event.preventDefault()
                                  focusAdjacentRow(event.currentTarget, 1)
                                } else if (event.key === 'ArrowUp') {
                                  event.preventDefault()
                                  focusAdjacentRow(event.currentTarget, -1)
                                }
                              }}
                              className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-0.5 text-start"
                            >
                              <span className="truncate">{catalog.name}</span>
                              {catalog.ref === selectedCatalogRef && (
                                <Check className="ms-auto size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                              )}
                            </button>
                          </div>

                          {!catalogCollapsed && (
                            <div role="group">
                              {catalog.profiles.map((profile) => {
                                const ref = formatScopedRef(profile.scope, profile.id)
                                const isSelected = ref === value
                                const isFavorite = ref === favoriteRef
                                const row = (
                                  <button
                                    type="button"
                                    data-tree-row
                                    onClick={() => onChange(ref)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'ArrowDown') {
                                        event.preventDefault()
                                        focusAdjacentRow(event.currentTarget, 1)
                                      } else if (event.key === 'ArrowUp') {
                                        event.preventDefault()
                                        focusAdjacentRow(event.currentTarget, -1)
                                      }
                                    }}
                                    className={cn(
                                      'relative flex w-full min-w-0 items-center gap-1.5 truncate rounded-md ps-12 pe-2 py-1 text-start text-sm',
                                      isSelected
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-foreground hover:bg-accent',
                                    )}
                                  >
                                    {isFavorite && (
                                      // Absolutely positioned in the row's
                                      // own indent gutter (`ps-12`) so it
                                      // never shifts where the profile
                                      // number starts, favourited or not.
                                      <Star
                                        className="absolute start-8 top-1/2 size-3.5 shrink-0 -translate-y-1/2 fill-current text-amber-500"
                                        aria-hidden="true"
                                      />
                                    )}
                                    <span className="truncate">{profile.profileNo}</span>
                                    <span
                                      className={cn(
                                        'shrink-0 text-xs',
                                        isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground',
                                      )}
                                      dir="ltr"
                                      title={tLookups('fields.maxGlassThickness')}
                                    >
                                      {profile.maxGlassThickness}mm
                                    </span>
                                    {isSelected && (
                                      <Check className="ms-auto size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                                    )}
                                  </button>
                                )
                                if (!onSetFavorite) return <div key={ref} role="treeitem">{row}</div>
                                return (
                                  <div key={ref} role="treeitem">
                                    <ContextMenu>
                                      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                                      <ContextMenuContent>
                                        <ContextMenuItem onSelect={() => onSetFavorite(ref)}>
                                          {t('profilePicker.setFavorite')}
                                        </ContextMenuItem>
                                      </ContextMenuContent>
                                    </ContextMenu>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
