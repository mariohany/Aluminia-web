import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis.module';
import { User } from '../../database/control-plane/entities/user.entity';

export const AUTH_VERSION_KEY_PREFIX = 'auth:ver:';

// Long enough that an active user is read from Postgres about once an
// hour, short enough to bound how long a missed publish (a crash between
// commit and Redis) could leave a stale number behind.
const CACHE_TTL_SECONDS = 60 * 60;

// Marks a deleted user, so a reader that loaded the old version just
// before the delete can't put it back (its write is SET NX).
const DELETED = 'deleted';

// Raise only: writes the new version unless a higher one (or the
// deleted mark) is already there. Two bumps publishing out of order
// can't leave the lower number behind.
const PUBLISH_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == '${DELETED}' then return 0 end
if current and tonumber(current) >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
`;

/**
 * Makes a change to a user's access take effect on their next request
 * (stability S3). The access token stays a JWT carrying the role and
 * company — nothing is looked up for those — plus `ver`, the user's
 * `auth_version` when it was issued. JwtAuthGuard compares that with
 * the current version, one small Redis read per request, and refuses a
 * token that is behind. The browser then refreshes: a role change comes
 * back as a new token with the new role; a forced logout (the session
 * was deleted too) comes back as 401.
 *
 * Postgres holds the truth; Redis only caches the number. To bump:
 * `bump()` inside the change's own transaction, then `publish()` with
 * its result after the commit — never before, or a rolled-back change
 * would still lock the user out.
 */
@Injectable()
export class AuthVersionService {
  private readonly logger = new Logger(AuthVersionService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** The user's current version, or null if the user no longer exists. */
  async current(userId: string): Promise<number | null> {
    const key = this.key(userId);
    try {
      const cached = await this.redis.get(key);
      if (cached === DELETED) return null;
      if (cached !== null) return Number(cached);
    } catch (error: unknown) {
      // Redis down: answer from Postgres instead of refusing everyone.
      this.logger.warn({ err: error }, 'auth version: Redis read failed');
      return this.load(userId);
    }

    const version = await this.load(userId);
    if (version === null) return null;
    try {
      // NX: a bump published meanwhile is newer than what was just read.
      await this.redis.set(key, String(version), 'EX', CACHE_TTL_SECONDS, 'NX');
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'auth version: Redis write failed');
    }
    return version;
  }

  /** Adds 1 to the version of one user, or of every user of a company.
   * Run inside the change's transaction; publish the result after it
   * commits. */
  async bump(
    manager: EntityManager,
    target: { userId: string } | { companyId: string },
  ): Promise<BumpedVersion[]> {
    const [column, value] =
      'userId' in target
        ? ['id', target.userId]
        : ['company_id', target.companyId];
    const [rows] = await manager.query<
      [Array<{ id: string; auth_version: number }>, number]
    >(
      `UPDATE "users" SET "auth_version" = "auth_version" + 1
       WHERE "${column}" = $1 RETURNING "id", "auth_version"`,
      [value],
    );
    return rows.map((row) => ({ userId: row.id, version: row.auth_version }));
  }

  /** Puts bumped versions into Redis — call after the commit. */
  async publish(bumped: BumpedVersion[]): Promise<void> {
    for (const { userId, version } of bumped) {
      try {
        await this.redis.eval(
          PUBLISH_SCRIPT,
          1,
          this.key(userId),
          version,
          CACHE_TTL_SECONDS,
        );
      } catch (error: unknown) {
        // The cached number expires within the hour, and the access
        // tokens it would let through expire sooner; nothing to retry.
        this.logger.warn(
          { err: error, userId },
          'auth version: publish failed',
        );
      }
    }
  }

  /** Marks deleted users — call after the commit. */
  async publishDeleted(userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.redis.set(
          this.key(userId),
          DELETED,
          'EX',
          CACHE_TTL_SECONDS,
        );
      } catch (error: unknown) {
        this.logger.warn(
          { err: error, userId },
          'auth version: publish failed',
        );
      }
    }
  }

  private async load(userId: string): Promise<number | null> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, authVersion: true },
    });
    return user ? user.authVersion : null;
  }

  private key(userId: string): string {
    return `${AUTH_VERSION_KEY_PREFIX}${userId}`;
  }
}

export interface BumpedVersion {
  userId: string;
  version: number;
}
