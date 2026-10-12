import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import type { JwtPayload } from '../jwt-payload';
import { AuthVersionService } from '../auth-version.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly authVersions: AuthVersionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing access token.');

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }

    // A valid signature isn't enough: the user's access may have changed
    // since this token was issued (stability S3). One Redis read; the
    // role and company still come from the token itself. The browser
    // answers this 401 by refreshing, which issues a token for the
    // user's access as it is now — or fails if they were logged out.
    const current = await this.authVersions.current(payload.sub);
    if (current === null || current !== (payload.ver ?? 0)) {
      throw new UnauthorizedException('Access has changed; sign in again.');
    }

    request.user = {
      id: payload.sub,
      role: payload.role,
      companyId: payload.companyId,
    };
    return true;
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}
