import { randomBytes, createHash } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EntityManager, Repository } from 'typeorm';
import ms from 'ms';
import type { AuthenticatedUser } from '@repo/types/auth';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import {
  GraceToken,
  Session,
} from '../../database/control-plane/entities/session.entity';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import type { Env } from '../../config/env.schema';
import { REFRESH_GRACE_DEPTH, REFRESH_GRACE_MS } from './auth.constants';
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

    return this.issueTokens(user, this.sessions.manager, null);
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const hash = hashToken(rawRefreshToken);

    // Serialised on the session row. Two page loads refreshing at the
    // same instant (Chrome restoring several tabs) both present the same
    // cookie; without the lock both would read the pre-rotation row and
    // write competing tokens, and the browser would be left holding
    // whichever one lost. Locking makes the second call see the first
    // one's rotation and rotate on from it, so every token the browser
    // could still be holding is either the current one or the one inside
    // its grace window.
    return this.sessions.manager.transaction(async (manager) => {
      // Matched in application code rather than SQL: the grace hashes
      // live in a jsonb array, and the row is found by user-independent
      // hash either way. `refreshTokenHash` is the common case; the
      // fallback scan is what catches a tab that is one rotation behind.
      const session =
        (await manager.findOne(Session, {
          where: { refreshTokenHash: hash },
          lock: { mode: 'pessimistic_write' },
        })) ??
        (await manager
          .createQueryBuilder(Session, 'session')
          .setLock('pessimistic_write')
          .where(
            `session.grace_tokens @> :probe::jsonb`,
            { probe: JSON.stringify([{ hash }]) },
          )
          .getOne());

      // A token that is neither the current one nor a live grace token
      // is refused but does *not* kill the session: the legitimate
      // holder may still be sitting on the current token, and a stale
      // cookie replayed from a second browser must not log them out.
      // Only an actually expired session is cleaned up here.
      if (!session) throw new UnauthorizedException('Session expired or invalid.');
      if (session.expiresAt.getTime() < Date.now()) {
        await manager.delete(Session, { id: session.id });
        throw new UnauthorizedException('Session expired or invalid.');
      }
      if (!acceptsToken(session, hash)) {
        throw new UnauthorizedException('Session expired or invalid.');
      }

      const user = await manager.findOne(User, { where: { id: session.userId } });
      if (!user || user.status !== UserStatus.ACTIVE) {
        await manager.delete(Session, { id: session.id });
        throw new UnauthorizedException('User no longer active.');
      }

      return this.issueTokens(user, manager, session);
    });
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

  private async issueTokens(
    user: User,
    manager: EntityManager,
    // The session being rotated, when this is a refresh rather than a
    // fresh login — its current hash joins the grace list.
    rotatingFrom: Session | null,
  ): Promise<TokenPair> {
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
    // A fresh login clears the grace list outright: nothing from the
    // previous session should survive a new sign-in.
    await manager.upsert(
      Session,
      {
        userId: user.id,
        refreshTokenHash,
        graceTokens: rotatingFrom ? nextGraceTokens(rotatingFrom) : [],
        expiresAt: refreshExpiresAt,
      },
      { conflictPaths: ['userId'] },
    );

    return { accessToken, refreshToken, refreshExpiresAt, user };
  }
}

// The current token always works; a token it replaced works until its
// own grace window lapses.
function acceptsToken(session: Session, hash: string): boolean {
  if (session.refreshTokenHash === hash) return true;
  return liveGraceTokens(session).some((token) => token.hash === hash);
}

function liveGraceTokens(session: Session): GraceToken[] {
  const now = Date.now();
  return (session.graceTokens ?? []).filter(
    (token) => new Date(token.expiresAt).getTime() > now,
  );
}

// Newest first, capped — the token being rotated away joins the front of
// the list and the oldest falls off the back.
function nextGraceTokens(rotatingFrom: Session): GraceToken[] {
  return [
    {
      hash: rotatingFrom.refreshTokenHash,
      expiresAt: new Date(Date.now() + REFRESH_GRACE_MS).toISOString(),
    },
    ...liveGraceTokens(rotatingFrom),
  ].slice(0, REFRESH_GRACE_DEPTH);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
