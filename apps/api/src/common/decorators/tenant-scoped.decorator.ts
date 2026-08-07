import { SetMetadata } from '@nestjs/common';

export const TENANT_SCOPED_KEY = 'tenantScoped';

// Opt-in, like @Roles() — a route with no @TenantScoped() is left alone
// by TenantGuard entirely. Marking a route makes its tenant requirement
// explicit and greppable, rather than an assumption buried in whichever
// service it happens to call.
export const TenantScoped = () => SetMetadata(TENANT_SCOPED_KEY, true);
