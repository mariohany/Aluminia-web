import type { UserRole } from '@repo/types/auth';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  companyId: string | null;
  // The user's `auth_version` when this token was issued (stability S3).
  // Optional only for tokens issued before it existed, which count as 0.
  ver?: number;
}

export interface AuthenticatedRequestUser {
  id: string;
  role: UserRole;
  companyId: string | null;
}
