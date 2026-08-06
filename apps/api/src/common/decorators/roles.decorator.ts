import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@repo/types/auth';

export const ROLES_KEY = 'roles';

// Opt-in, unlike @Public(): a route with no @Roles() is reachable by any
// authenticated user, exactly as before this guard existed. Only routes
// that declare specific roles get restricted.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
