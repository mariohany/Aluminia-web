import type { UserRole } from '@repo/types/auth';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  companyId: string | null;
}

export interface AuthenticatedRequestUser {
  id: string;
  role: UserRole;
  companyId: string | null;
}
