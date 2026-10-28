import { BadRequestException, Injectable } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { UserRole } from '@repo/types/auth';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import {
  AuthVersionService,
  type BumpedVersion,
} from '../auth/auth-version.service';

export interface FreeSeatChange {
  keptUserId: string | null;
  deactivated: string[];
  // Publish after the commit (CLAUDE.md, Auth).
  bumped: BumpedVersion[];
}

/**
 * Who may still use a company when its plan changes
 * (docs/subscriptions_planing.md B13, B14). Both run inside the caller's
 * transaction, which must already hold the company row lock (the seat
 * check in UsersService takes the same lock).
 */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly authVersions: AuthVersionService) {}

  /**
   * Free has one seat: ONE company admin stays active and every other
   * active user is deactivated with `plan_deactivated`, logged out like a
   * manual deactivate. `keepAdminId` picks the admin (Edit subscription);
   * null keeps the oldest active one (a trial ending). Calling it again on
   * Free with another admin swaps them: the new one comes back only if the
   * drop to Free deactivated them.
   */
  async dropToFree(
    manager: EntityManager,
    companyId: string,
    keepAdminId: string | null,
  ): Promise<FreeSeatChange> {
    const users = await manager.find(User, {
      where: { companyId },
      order: { createdAt: 'ASC' },
    });
    const admins = users.filter((u) => u.role === UserRole.COMPANY_ADMIN);

    let keep: User | undefined;
    if (keepAdminId) {
      keep = admins.find((u) => u.id === keepAdminId);
      const usable =
        keep && (keep.status === UserStatus.ACTIVE || keep.planDeactivated);
      if (!usable) {
        throw new BadRequestException({
          message:
            'Pick an active company admin of this company to stay on Free.',
          code: 'free_admin_invalid',
        });
      }
    } else {
      // A company without an active admin keeps its oldest active user.
      keep =
        admins.find((u) => u.status === UserStatus.ACTIVE) ??
        users.find((u) => u.status === UserStatus.ACTIVE);
    }

    if (keep && keep.status === UserStatus.INACTIVE) {
      keep.status = UserStatus.ACTIVE;
      keep.planDeactivated = false;
      await manager.save(keep);
    }

    const leaving = users.filter(
      (u) => u.id !== keep?.id && u.status === UserStatus.ACTIVE,
    );
    const bumped: BumpedVersion[] = [];
    if (leaving.length > 0) {
      const ids = leaving.map((u) => u.id);
      await manager.update(
        User,
        { id: In(ids) },
        { status: UserStatus.INACTIVE, planDeactivated: true },
      );
      await manager.query(
        `DELETE FROM "sessions" WHERE "user_id" = ANY($1::uuid[])`,
        [ids],
      );
      for (const id of ids) {
        bumped.push(...(await this.authVersions.bump(manager, { userId: id })));
      }
    }

    return {
      keptUserId: keep?.id ?? null,
      deactivated: leaving.map((u) => u.id),
      bumped,
    };
  }

  /**
   * Back on a paid plan: exactly the users the drop to Free deactivated
   * come back. Someone a company admin deactivated stays deactivated.
   * The seat check already counts them (deactivated users hold a seat).
   */
  async restoreFromFree(
    manager: EntityManager,
    companyId: string,
  ): Promise<string[]> {
    const rows: Array<{ id: string }> = await manager.query(
      `UPDATE "users" SET "status" = 'active', "plan_deactivated" = false, "updated_at" = now()
       WHERE "company_id" = $1 AND "plan_deactivated" RETURNING "id"`,
      [companyId],
    );
    return rows.map((row) => row.id);
  }
}
