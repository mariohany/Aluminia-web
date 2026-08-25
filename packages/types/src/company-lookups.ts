import { z } from 'zod'
import {
  CombinationItemKind,
  GlassGapType,
  ProfileType,
  SystemType,
  alternatesSheetAndGap,
  alternationIssue,
  boundedBySheetIssue,
  gapThicknessIssue,
  gapThicknessMatchesType,
  startsAndEndsWithSheet,
  type BulkDeleteResult,
} from '@repo/types/lookups'

// Phase 2 of Company Lookups (docs/company_lookups_planing.md) — a
// manufacturer's own rows in the same 8 lookup categories as the shared
// platform catalogue in lookups.ts. Every schema/type here has a direct
// platform counterpart there; re-exported and reused wherever the shape
// is identical (colours, paint brands, glass, system brands need no
// company-specific schema at all — see admin-lookups.controller.ts's
// sibling for how those four get built straight from lookups.ts), and
// re-derived here only where a row carries a parent reference that may
// point at either scope.

// ---- Scope -------------------------------------------------------------

export const LookupScope = {
  PLATFORM: 'platform',
  COMPANY: 'company',
} as const
export type LookupScope = (typeof LookupScope)[keyof typeof LookupScope]

// A parent reference that may point at either scope, encoded as one
// string ("platform:<uuid>" / "company:<uuid>") rather than a
// scope+id pair — so the existing `type: 'select'` field spec
// (LookupTableSection, a single string value per option) needs no shape
// change to carry a cross-scope reference.
export const scopedRefSchema = z
  .string()
  .regex(/^(platform|company):[0-9a-f-]{36}$/, 'Must be a scoped reference ("platform:<uuid>" or "company:<uuid>").')
export type ScopedRef = z.infer<typeof scopedRefSchema>

export function formatScopedRef(scope: LookupScope, id: string): ScopedRef {
  return `${scope}:${id}`
}

export function parseScopedRef(ref: ScopedRef): { scope: LookupScope; id: string } {
  const [scope, id] = ref.split(':') as [LookupScope, string]
  return { scope, id }
}

// ---- Colour cluster ------------------------------------------------------

// No company-specific create/update schema: `createColorSchema` /
// `updateColorSchema` (lookups.ts) already match this table's shape
// exactly — a colour carries no parent reference to re-derive.

export interface CompanyColorSummary {
  id: string
  code: string
  hex: string
  scope: typeof LookupScope.COMPANY
  createdAt: string
  updatedAt: string
}

// No company-specific create/update schema — same reasoning as colour.

export interface CompanyPaintBrandSummary {
  id: string
  name: string
  scope: typeof LookupScope.COMPANY
  createdAt: string
  updatedAt: string
}

export const createCompanyPaintingPriceSchema = z.object({
  brand: scopedRefSchema,
  type: z.string().trim().min(1).max(50),
  price: z.number().nonnegative(),
})
export type CreateCompanyPaintingPriceInput = z.infer<typeof createCompanyPaintingPriceSchema>
export const updateCompanyPaintingPriceSchema = createCompanyPaintingPriceSchema.partial()
export type UpdateCompanyPaintingPriceInput = z.infer<typeof updateCompanyPaintingPriceSchema>

export interface CompanyPaintingPriceSummary {
  id: string
  brand: ScopedRef
  // `null` means the referenced platform brand has since been deleted —
  // surfaced on read as unavailable, never blocked at delete time on
  // the platform side. See the planing doc's "Accepted risks" #1.
  brandName: string | null
  brandScope: LookupScope
  type: string
  price: number
  scope: typeof LookupScope.COMPANY
  createdAt: string
  updatedAt: string
}

// ---- Glass cluster -----------------------------------------------------

// No company-specific create/update schema — `createGlassSchema` /
// `updateGlassSchema` already match; glass carries no parent reference.

export interface CompanyGlassSummary {
  id: string
  name: string
  thickness: number
  weightPerSqm: number
  pricePerSqm: number
  scope: typeof LookupScope.COMPANY
  createdAt: string
  updatedAt: string
}

// Same discriminated-union shape as lookups.ts's glassCombinationItemSchema,
// with each of the three references (glass, colour, gap colour) widened
// to a ScopedRef — a company combination may mix platform-owned and
// company-owned glass/colours freely (planing doc, "Cross-scope
// references").
const companyGlassCombinationSheetSchema = z.object({
  kind: z.literal(CombinationItemKind.SHEET),
  glass: scopedRefSchema,
  color: scopedRefSchema.nullable().optional(),
})

const companyGlassCombinationGapSchema = z.object({
  kind: z.literal(CombinationItemKind.GAP),
  gapType: z.enum([GlassGapType.LAMINATED, GlassGapType.SPACER]),
  gapThickness: z.number().nonnegative(),
  gapColor: scopedRefSchema.nullable().optional(),
  isGeorgian: z.boolean().nullable().optional(),
  columnsCount: z.number().int().positive().nullable().optional(),
  rowsCount: z.number().int().positive().nullable().optional(),
})

export const companyGlassCombinationItemSchema = z.discriminatedUnion('kind', [
  companyGlassCombinationSheetSchema,
  companyGlassCombinationGapSchema,
])
export type CompanyGlassCombinationItemInput = z.infer<typeof companyGlassCombinationItemSchema>

const companyGlassCombinationBaseSchema = z.object({
  name: z.string().trim().min(1).max(255),
  items: z
    .array(companyGlassCombinationItemSchema)
    .min(3, 'A combination needs at least two glass sheets (sheet, gap, sheet) — a single layer is not a combination.'),
})

// Reuses lookups.ts's three structural predicates (alternation,
// sheet-bounding, gap-thickness-by-type) rather than redefining them —
// see CombinationItemShapeInput's comment there for why that's safe.
export const createCompanyGlassCombinationSchema = companyGlassCombinationBaseSchema
  .refine((data) => startsAndEndsWithSheet(data.items), boundedBySheetIssue)
  .refine((data) => alternatesSheetAndGap(data.items), alternationIssue)
  .refine((data) => gapThicknessMatchesType(data.items), gapThicknessIssue)
export type CreateCompanyGlassCombinationInput = z.infer<typeof createCompanyGlassCombinationSchema>

export const updateCompanyGlassCombinationSchema = companyGlassCombinationBaseSchema
  .partial()
  .refine((data) => data.items === undefined || startsAndEndsWithSheet(data.items), boundedBySheetIssue)
  .refine((data) => data.items === undefined || alternatesSheetAndGap(data.items), alternationIssue)
  .refine((data) => data.items === undefined || gapThicknessMatchesType(data.items), gapThicknessIssue)
export type UpdateCompanyGlassCombinationInput = z.infer<typeof updateCompanyGlassCombinationSchema>

// Mirrors looseGlassCombinationSchema — bulk-duplicate's request body is
// checked shape-only here too, with the real structural rules applied
// per-item in the service (see lookups.ts's comment on the platform
// version for why: one legacy/invalid item shouldn't 400 a whole batch).
export const looseCompanyGlassCombinationSchema = z.object({
  name: z.string().trim().min(1).max(255),
  items: z.array(z.unknown()).min(1),
})
export type LooseCompanyGlassCombinationInput = z.infer<typeof looseCompanyGlassCombinationSchema>

export interface CompanyGlassCombinationItemSheetSummary {
  kind: typeof CombinationItemKind.SHEET
  position: number
  glass: ScopedRef
  glassName: string | null
  glassScope: LookupScope
  glassThickness: number | null
  color: ScopedRef | null
  colorCode: string | null
  colorScope: LookupScope | null
}

export interface CompanyGlassCombinationItemGapSummary {
  kind: typeof CombinationItemKind.GAP
  position: number
  gapType: GlassGapType
  gapThickness: number
  gapColor: ScopedRef | null
  colorCode: string | null
  colorScope: LookupScope | null
  isGeorgian: boolean | null
  columnsCount: number | null
  rowsCount: number | null
}

export type CompanyGlassCombinationItemSummary =
  | CompanyGlassCombinationItemSheetSummary
  | CompanyGlassCombinationItemGapSummary

export interface CompanyGlassCombinationSummary {
  id: string
  name: string
  totalThickness: number
  items: CompanyGlassCombinationItemSummary[]
  scope: typeof LookupScope.COMPANY
  createdAt: string
  updatedAt: string
}

// ---- Systems cluster ----------------------------------------------------

// No company-specific create/update schema — `createSystemBrandSchema` /
// `updateSystemBrandSchema` already match; a brand carries no parent
// reference.

export interface CompanySystemBrandSummary {
  id: string
  name: string
  scope: typeof LookupScope.COMPANY
  createdAt: string
  updatedAt: string
}

export const createCompanySystemCatalogSchema = z.object({
  brand: scopedRefSchema,
  name: z.string().trim().min(1).max(255),
  systemType: z.enum([SystemType.SLIDING, SystemType.HINGED, SystemType.CURTAIN_WALL]),
  maxGlassThickness: z.number().int().positive(),
  maxSashWeight: z.number().int().positive(),
})
export type CreateCompanySystemCatalogInput = z.infer<typeof createCompanySystemCatalogSchema>
export const updateCompanySystemCatalogSchema = createCompanySystemCatalogSchema.partial()
export type UpdateCompanySystemCatalogInput = z.infer<typeof updateCompanySystemCatalogSchema>

export interface CompanySystemCatalogSummary {
  id: string
  brand: ScopedRef
  brandName: string | null
  brandScope: LookupScope
  name: string
  systemType: SystemType
  maxGlassThickness: number
  maxSashWeight: number
  scope: typeof LookupScope.COMPANY
  createdAt: string
  updatedAt: string
}

export const createCompanySystemProfileSchema = z.object({
  catalog: scopedRefSchema,
  profileNo: z.string().trim().min(1).max(100),
  profileType: z.enum([
    ProfileType.FRAME,
    ProfileType.LEAF,
    ProfileType.TRANSOM,
    ProfileType.GLASS_BEADING,
    ProfileType.INSERT,
    ProfileType.SLIDING_INSERT,
    ProfileType.CONTROL_ROD,
    ProfileType.BOTTOM_RAIL,
  ]),
  maxGlassThickness: z.number().int().positive(),
  weight: z.number().positive(),
  perimeter: z.number().int().positive(),
  inertiaIx: z.number().positive(),
  inertiaIy: z.number().positive(),
  image: z.url().nullable().optional(),
  acceptsFlyScreen: z.boolean(),
})
export type CreateCompanySystemProfileInput = z.infer<typeof createCompanySystemProfileSchema>
export const updateCompanySystemProfileSchema = createCompanySystemProfileSchema.partial()
export type UpdateCompanySystemProfileInput = z.infer<typeof updateCompanySystemProfileSchema>

export interface CompanySystemProfileSummary {
  id: string
  catalog: ScopedRef
  catalogName: string | null
  catalogScope: LookupScope
  profileNo: string
  profileType: ProfileType
  maxGlassThickness: number
  weight: number
  perimeter: number
  inertiaIx: number
  inertiaIy: number
  image: string | null
  acceptsFlyScreen: boolean
  scope: typeof LookupScope.COMPANY
  createdAt: string
  updatedAt: string
}

// ---- The tenant read API -------------------------------------------------

// GET /company/lookups/:slice — same three slices as the platform's
// GET /lookups/:slice (LookupSlice, lookups.ts), returning only this
// tenant's own rows; the frontend does the platform+company union
// (useMergedLookupSlice).
export interface CompanyGlassLookups {
  glass: CompanyGlassSummary[]
  combinations: CompanyGlassCombinationSummary[]
}

export interface CompanyColorLookups {
  colors: CompanyColorSummary[]
  brands: CompanyPaintBrandSummary[]
  prices: CompanyPaintingPriceSummary[]
}

export interface CompanySystemLookups {
  brands: CompanySystemBrandSummary[]
  catalogs: CompanySystemCatalogSummary[]
  profiles: CompanySystemProfileSummary[]
}

// Re-exported so a caller only needs this one module for every
// company-lookups type — `bulkIdsSchema`/`bulkCreateSchema` are reused
// as-is (see lookups.ts), and `BulkDeleteResult`'s
// `{ deletedIds, blockedIds }` partial-success shape is exactly what the
// company bulk-delete endpoints return too.
export { bulkIdsSchema, bulkCreateSchema, type BulkIdsInput } from '@repo/types/lookups'
export type { BulkDeleteResult }
