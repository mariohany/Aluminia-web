import { randomBytes, createHash } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import ms from 'ms';
import type { AuthenticatedUser } from '@repo/types/auth';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import type { Env } from '../../config/env.schema';
import type { JwtPayload } from './jwt-payload';
import { PasswordService } from './password.service';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: User;
}

export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.users.findOne({ where: { email } });
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      !(await this.passwordService.verify(user.passwordHash, password))
    ) {
      // Deliberately the same error for "no such user" and "wrong
      // password" — telling them apart lets an attacker enumerate emails.
      throw new UnauthorizedException('Invalid email or password.');
    }

    // Closes the gap Phase 7 left open: a super admin carries no
    // companyId and skips this entirely; a company-scoped user whose
    // company has been archived is rejected here, on every login
    // attempt, not just at the moment of archiving.
    if (user.companyId) {
      const company = await this.companies.findOne({ where: { id: user.companyId } });
      if (!company || company.status !== CompanyStatus.ACTIVE) {
        throw new UnauthorizedException('This company is not active.');
      }
    }

    return this.issueTokens(user);
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const hash = hashToken(rawRefreshToken);
    const session = await this.sessions.findOne({
      where: { refreshTokenHash: hash },
    });

    if (!session || session.expiresAt.getTime() < Date.now()) {
      if (session) await this.sessions.delete({ id: session.id });
      throw new UnauthorizedException('Session expired or invalid.');
    }

    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.sessions.delete({ id: session.id });
      throw new UnauthorizedException('User no longer active.');
    }

    return this.issueTokens(user);
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    await this.sessions.delete({
      refreshTokenHash: hashToken(rawRefreshToken),
    });
  }

  async getAuthenticatedUser(id: string): Promise<AuthenticatedUser> {
    const user = await this.users.findOne({ where: { id } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User no longer active.');
    }
    return toAuthenticatedUser(user);
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      companyId: user.companyId,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    const refreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = hashToken(refreshToken);
    const ttlMs = ms(
      this.config.get('JWT_REFRESH_EXPIRES_IN', {
        infer: true,
      }),
    );
    const refreshExpiresAt = new Date(Date.now() + ttlMs);

    // Upsert on user_id — the column's unique constraint is what makes
    // this replace-not-append, structurally enforcing one session per
    // user rather than trusting application code to delete the old one.
    await this.sessions.upsert(
      { userId: user.id, refreshTokenHash, expiresAt: refreshExpiresAt },
      { conflictPaths: ['userId'] },
    );

    return { accessToken, refreshToken, refreshExpiresAt, user };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
