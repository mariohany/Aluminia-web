import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequestUser } from '../jwt-payload';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedRequestUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // Only used behind JwtAuthGuard, which always sets this — the `!` is
    // safe here, not an assumption the type system can see through itself.
    return request.user!;
  },
);
