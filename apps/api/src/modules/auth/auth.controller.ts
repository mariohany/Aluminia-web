import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { LoginResponse, MeResponse } from '@repo/types/auth';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env.schema';
import { AuthService, toAuthenticatedUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from './jwt-payload';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { accessToken, refreshToken, refreshExpiresAt, user } =
      await this.authService.login(dto.email, dto.password);
    this.setRefreshCookie(res, refreshToken, refreshExpiresAt);
    return { accessToken, user: toAuthenticatedUser(user) };
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const raw = readRefreshCookie(req);
    if (!raw) throw new UnauthorizedException('No refresh token.');

    const { accessToken, refreshToken, refreshExpiresAt, user } =
      await this.authService.refresh(raw);
    this.setRefreshCookie(res, refreshToken, refreshExpiresAt);
    return { accessToken, user: toAuthenticatedUser(user) };
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedRequestUser): Promise<MeResponse> {
    return this.authService.getAuthenticatedUser(user.id);
  }

  private setRefreshCookie(
    res: Response,
    token: string,
    expiresAt: Date,
  ): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      expires: expiresAt,
    });
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME];
}
