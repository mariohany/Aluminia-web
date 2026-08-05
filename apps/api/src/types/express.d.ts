import type { AuthenticatedRequestUser } from '../modules/auth/jwt-payload';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedRequestUser;
    }
  }
}
