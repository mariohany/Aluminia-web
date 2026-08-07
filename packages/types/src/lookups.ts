import { z } from 'zod'

// Same rationale as CompanyStatus in companies.ts: const objects, not TS
// `enum`s, so they survive erasable-syntax-only TypeScript stripping —
// and the entity files import + re-export these directly rather than
// redeclaring the values, so there's one source of truth for each.

export const CombinationItemKind = {
  SHEET: 'sheet',
  GAP: 'gap',
} as const
export type CombinationItemKind = (typeof CombinationItemKind)[keyof typeof CombinationItemKind]

export const GlassGapType = {
  LAMINATED: 'laminated',
  SPACER: 'spacer',
} as const
export type GlassGapType = (typeof GlassGapType)[keyof typeof GlassGapType]

export const SystemType = {
  SLIDING: 'sliding',
  HINGED: 'hinged',
  CURTAIN_WALL: 'curtain_wall',
} as const
export type SystemType = (typeof SystemType)[keyof typeof SystemType]

export const ProfileType = {
  FRAME: 'frame',
  LEAF: 'leaf',
  TRANSOM: 'transom',
  GLASS_BEADING: 'glass_beading',
  INSERT: 'insert',
  SLIDING_INSERT: 'sliding_insert',
  CONTROL_ROD: 'control_rod',
} as const
export type ProfileType = (typeof ProfileType)[keyof typeof ProfileType]

// The three cache/read slices — matches the cluster boundaries in
// Section 4 (the only cross-cluster FK is glass reaching into colour).
export const LookupSlice = {
  GLASS: 'glass',
  COLORS: 'colors',
  SYSTEMS: 'systems',
} as const
export type LookupSlice = (typeof LookupSlice)[keyof typeof LookupSlice]

// One version counter per entity, not one global counter — a write to
// `color` no longer retires the cached `systems` slice. `lookup_meta`
// has one row per value here; GlassCombinationItem isn't its own
// entity because items aren't exposed as their own resource — a write
// to them bumps GLASS_COMBINATION's row instead (see the migration).
export const LookupEntity = {
  COLOR: 'color',
  COLOR_BRAND: 'color_brand',
  COLOR_PRICE: 'color_price',
  GLASS: 'glass',
  GLASS_COMBINATION: 'glass_combination',
  SYSTEM_BRAND: 'system_brand',
  SYSTEM_CATALOG: 'system_catalog',
  SYSTEM_PROFILE: 'system_profile',
} as const
export type LookupEntity = (typeof LookupEntity)[keyof typeof LookupEntity]

// Which entities feed each read slice — the slice's cache key is a
// composite of these entities' versions (see LookupCacheService).
export const LOOKUP_SLICE_ENTITIES: Record<LookupSlice, LookupEntity[]> = {
  [LookupSlice.GLASS]: [LookupEntity.GLASS, LookupEntity.GLASS_COMBINATION],
  [LookupSlice.COLORS]: [LookupEntity.COLOR, LookupEntity.COLOR_BRAND, LookupEntity.COLOR_PRICE],
  [LookupSlice.SYSTEMS]: [LookupEntity.SYSTEM_BRAND, LookupEntity.SYSTEM_CATALOG, LookupEntity.SYSTEM_PROFILE],
}

// ---- Colour cluster --------------------------------------------------

export const createColorSchema = z.object({
  code: z.string().trim().min(1).max(50),
  hex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour, e.g. #F1F0EA.'),
})
export type CreateColorInput = z.infer<typeof createColorSchema>
export const updateColorSchema = createColorSchema.partial()
export type UpdateColorInput = z.infer<typeof updateColorSchema>

export interface ColorSummary {
  id: string
  code: string
  hex: string
  createdAt: string
  updatedAt: string
}

export const createColorBrandSchema = z.object({
  name: z.string().trim().min(1).max(255),
})
export type CreateColorBrandInput = z.infer<typeof createColorBrandSchema>
export const updateColorBrandSchema = createColorBrandSchema.partial()
export type UpdateColorBrandInput = z.infer<typeof updateColorBrandSchema>

export interface ColorBrandSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

// `type` stays a free string — the actual finish values (powder coat,
// anodised, wood-grain, ...) are still an open question (Section 4).
export const createColorPriceSchema = z.object({
  brandId: z.string().min(1),
  type: z.string().trim().min(1).max(50),
  price: z.number().nonnegative(),
})
export type CreateColorPriceInput = z.infer<typeof createColorPriceSchema>
export const updateColorPriceSchema = createColorPriceSchema.partial()
export type UpdateColorPriceInput = z.infer<typeof updateColorPriceSchema>

export interface ColorPriceSummary {
  id: string
  brandId: string
  brandName: string
  type: string
  price: number
  createdAt: string
  updatedAt: string
}

// ---- Glass cluster -----------------------------------------------------

export const createGlassSchema = z.object({
  name: z.string().trim().min(1).max(255),
  thickness: z.number().int().positive(),
  weightPerSqm: z.number().positive(),
  pricePerSqm: z.number().nonnegative(),
})
export type CreateGlassInput = z.infer<typeof createGlassSchema>
export const updateGlassSchema = createGlassSchema.partial()
export type UpdateGlassInput = z.infer<typeof updateGlassSchema>

export interface GlassSummary {
  id: string
  name: string
  thickness: number
  weightPerSqm: number
  pricePerSqm: number
  createdAt: string
  updatedAt: string
}

// A combination's item list mirrors the sealed-class shape from Section
// 4: a discriminated union, not two independently-optional halves, so an
// invalid mix (a sheet with a gapType, say) can't even be constructed.
// Georgian fields are only accepted when gapType is 'spacer' — the same
// rule the migration's check constraint enforces in the database.
const glassCombinationSheetSchema = z.object({
  kind: z.literal(CombinationItemKind.SHEET),
  glassId: z.string().min(1),
  colorId: z.string().min(1).nullable().optional(),
})

const glassCombinationGapSchema = z.object({
  kind: z.literal(CombinationItemKind.GAP),
  gapType: z.enum([GlassGapType.LAMINATED, GlassGapType.SPACER]),
  gapThickness: z.number().positive(),
  gapColorId: z.string().min(1).nullable().optional(),
  isGeorgian: z.boolean().nullable().optional(),
  columnsCount: z.number().int().positive().nullable().optional(),
  rowsCount: z.number().int().positive().nullable().optional(),
})

export const glassCombinationItemSchema = z.discriminatedUnion('kind', [
  glassCombinationSheetSchema,
  glassCombinationGapSchema,
])
export type GlassCombinationItemInput = z.infer<typeof glassCombinationItemSchema>

// Combinations are written whole: the editor adds/removes/reorders items
// client-side and saves the full ordered list in one request, which is
// also what keeps `position` consistent without a separate reorder call.
const glassCombinationBaseSchema = z.object({
  name: z.string().trim().min(1).max(255),
  items: z.array(glassCombinationItemSchema).min(1),
})

// A build-up has to be bounded by glass, not by a gap — there's nothing
// on the outside of the first/last layer for a spacer or interlayer to
// bond to. This isn't a per-row property (it depends on an item's
// position relative to the whole list), so it can't live in the
// discriminated-union item schema above; it's checked here, once, over
// the full array. Applying `.refine()` to the DTO (not just the editor's
// client-side check) means the backend rejects this shape too, since
// AdminLookupsController's DTOs wrap these same schemas.
const startsAndEndsWithSheet = (items: GlassCombinationItemInput[]) =>
  items[0]?.kind === CombinationItemKind.SHEET &&
  items[items.length - 1]?.kind === CombinationItemKind.SHEET

const boundedBySheetIssue = {
  message: 'A combination must start and end with a glass sheet, not a gap.',
  path: ['items'],
}

export const createGlassCombinationSchema = glassCombinationBaseSchema.refine(
  (data) => startsAndEndsWithSheet(data.items),
  boundedBySheetIssue,
)
export type CreateGlassCombinationInput = z.infer<typeof createGlassCombinationSchema>

export const updateGlassCombinationSchema = glassCombinationBaseSchema.partial().refine(
  (data) => data.items === undefined || startsAndEndsWithSheet(data.items),
  boundedBySheetIssue,
)
export type UpdateGlassCombinationInput = z.infer<typeof updateGlassCombinationSchema>

export interface GlassCombinationItemSheetSummary {
  kind: typeof CombinationItemKind.SHEET
  position: number
  glassId: string
  glassName: string
  glassThickness: number
  colorId: string | null
  colorCode: string | null
}

export interface GlassCombinationItemGapSummary {
  kind: typeof CombinationItemKind.GAP
  position: number
  gapType: GlassGapType
  gapThickness: number
  gapColorId: string | null
  colorCode: string | null
  isGeorgian: boolean | null
  columnsCount: number | null
  rowsCount: number | null
}

export type GlassCombinationItemSummary =
  | GlassCombinationItemSheetSummary
  | GlassCombinationItemGapSummary

export interface GlassCombinationSummary {
  id: string
  name: string
  // Derived from `items`, never stored — see the entity's comment.
  totalThickness: number
  items: GlassCombinationItemSummary[]
  createdAt: string
  updatedAt: string
}

// ---- Systems cluster --------------------------------------------------

export const createSystemBrandSchema = z.object({
  name: z.string().trim().min(1).max(255),
})
export type CreateSystemBrandInput = z.infer<typeof createSystemBrandSchema>
export const updateSystemBrandSchema = createSystemBrandSchema.partial()
export type UpdateSystemBrandInput = z.infer<typeof updateSystemBrandSchema>

export interface SystemBrandSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export const createSystemCatalogSchema = z.object({
  brandId: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  systemType: z.enum([SystemType.SLIDING, SystemType.HINGED, SystemType.CURTAIN_WALL]),
  maxGlassThickness: z.number().int().positive(),
  maxSashWeight: z.number().int().positive(),
})
export type CreateSystemCatalogInput = z.infer<typeof createSystemCatalogSchema>
export const updateSystemCatalogSchema = createSystemCatalogSchema.partial()
export type UpdateSystemCatalogInput = z.infer<typeof updateSystemCatalogSchema>

export interface SystemCatalogSummary {
  id: string
  brandId: string
  brandName: string
  name: string
  systemType: SystemType
  maxGlassThickness: number
  maxSashWeight: number
  createdAt: string
  updatedAt: string
}

export const createSystemProfileSchema = z.object({
  catalogId: z.string().min(1),
  profileNo: z.string().trim().min(1).max(100),
  profileType: z.enum([
    ProfileType.FRAME,
    ProfileType.LEAF,
    ProfileType.TRANSOM,
    ProfileType.GLASS_BEADING,
    ProfileType.INSERT,
    ProfileType.SLIDING_INSERT,
    ProfileType.CONTROL_ROD,
  ]),
  maxGlassThickness: z.number().int().positive(),
  weight: z.number().positive(),
  perimeter: z.number().int().positive(),
  inertiaIx: z.number().positive(),
  inertiaIy: z.number().positive(),
  image: z.url().nullable().optional(),
})
export type CreateSystemProfileInput = z.infer<typeof createSystemProfileSchema>
export const updateSystemProfileSchema = createSystemProfileSchema.partial()
export type UpdateSystemProfileInput = z.infer<typeof updateSystemProfileSchema>

export interface SystemProfileSummary {
  id: string
  catalogId: string
  catalogName: string
  profileNo: string
  profileType: ProfileType
  maxGlassThickness: number
  weight: number
  perimeter: number
  inertiaIx: number
  inertiaIy: number
  image: string | null
  createdAt: string
  updatedAt: string
}

// ---- The tenant read API ------------------------------------------------

// Keyed by LookupEntity — every entity's current version in one call,
// since the admin UI needs to show the version of whichever table is
// on screen, and a client fetching one slice needs to know which of
// its member entities is now stale.
export type LookupVersion = Record<LookupEntity, number>

export interface GlassLookups {
  glass: GlassSummary[]
  combinations: GlassCombinationSummary[]
}

export interface ColorLookups {
  colors: ColorSummary[]
  brands: ColorBrandSummary[]
  prices: ColorPriceSummary[]
}

export interface SystemLookups {
  brands: SystemBrandSummary[]
  catalogs: SystemCatalogSummary[]
  profiles: SystemProfileSummary[]
}
