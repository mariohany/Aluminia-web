import {
  LookupScope,
  formatScopedRef,
  parseScopedRef,
  type ScopedRef,
} from '@repo/types/company-lookups';

// A resolved ScopedRef, split into the nullable-pair shape every
// cross-scope-parent column uses (see the AddCompanyLookups migration's
// header comment, difference 3) — exactly one side is ever non-null.
export interface ResolvedParentPair {
  platformId: string | null;
  companyId: string | null;
}

export function resolveScopedRef(ref: ScopedRef): ResolvedParentPair {
  const { scope, id } = parseScopedRef(ref);
  return scope === LookupScope.PLATFORM
    ? { platformId: id, companyId: null }
    : { platformId: null, companyId: id };
}

// For the soft preference pairs (projects, project_settings): `null` /
// absent clears both columns; a real `ScopedRef` resolves to the pair.
// Those pairs carry no CHECK/FK (see project.entity.ts's doc comment).
export function resolveScopedRefPair(
  ref: ScopedRef | null | undefined,
): ResolvedParentPair {
  if (!ref) return { platformId: null, companyId: null };
  return resolveScopedRef(ref);
}

export function toScopedRef(
  platformId: string | null,
  companyId: string | null,
): ScopedRef | null {
  if (platformId) return formatScopedRef(LookupScope.PLATFORM, platformId);
  if (companyId) return formatScopedRef(LookupScope.COMPANY, companyId);
  return null;
}
