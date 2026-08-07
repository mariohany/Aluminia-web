import type { AuthenticatedRequestUser } from '../modules/auth/jwt-payload';
import type { ResolvedTenant } from '../modules/tenancy/resolved-tenant';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedRequestUser;
      // Set by TenantGuard once a @TenantScoped() route's claim has
      // passed every fail-closed gate. Undefined on any route that
      // isn't @TenantScoped() — never a default value.
      tenant?: ResolvedTenant;
    }
  }
}
