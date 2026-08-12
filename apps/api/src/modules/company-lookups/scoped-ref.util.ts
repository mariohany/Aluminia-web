import {
  LookupScope,
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
