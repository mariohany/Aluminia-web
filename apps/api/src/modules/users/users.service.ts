import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { UserRole } from '@repo/types/auth';
import type { CreateUserInput, UpdateUserInput, UserSummary } from '@repo/types/users';
import { User, UserStatus } from '../../database/control-plane/entities/user.entity';
import { Company } from '../../database/control-plane/entities/company.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import { PasswordService } from '../auth/password.service';
import { AuditLogService } from '../audit-log/audit-log.service';

interface CompanyLockRow {
  id: string;
  name: string;
  maxUsers: number;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly passwordService: PasswordService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(): Promise<UserSummary[]> {
    const [users, companies, sessions] = await Promise.all([
      this.users.find({ order: { createdAt: 'DESC' } }),
      this.companies.find(),
      this.sessions.find(),
    ]);
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
    const sessionByUserId = new Map(sessions.map((s) => [s.userId, s]));

    return users.map((user) =>
      toUserSummary(
        user,
        user.companyId ? (companyNameById.get(user.companyId) ?? null) : null,
        sessionByUserId.get(user.id) ?? null,
      ),
    );
  }

  async create(input: CreateUserInput, actorId: string): Promise<UserSummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const company = await this.lockCompanyForSeatCheck(queryRunner, input.companyId);

      const existing = await queryRunner.manager.findOne(User, { where: { email: input.email } });
      if (existing) throw new BadRequestException('A user with this email already exists.');

      await this.assertSeatAvailable(queryRunner, company);

      const user = await queryRunner.manager.save(
        queryRunner.manager.create(User, {
          email: input.email,
          passwordHash: await this.passwordService.hash(input.password),
          role: input.role,
          companyId: input.companyId,
          status: UserStatus.ACTIVE,
        }),
      );

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'user.created',
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email, role: user.role, companyId: user.companyId },
      });

      await queryRunner.commitTransaction();
      return toUserSummary(user, company.name, null);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async update(id: string, input: UpdateUserInput, actorId: string): Promise<UserSummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.findOne(User, { where: { id } });
      if (!user) throw new NotFoundException('User not found.');

      // Merge onto the existing user rather than requiring both fields
      // whenever either is sent: a plain role toggle between
      // company_admin and user (company unchanged) doesn't need to
      // resend companyId, but crossing the super-admin boundary only
      // validates correctly when both move together.
      const nextRole = input.role ?? user.role;
      const nextCompanyId = input.companyId !== undefined ? input.companyId : user.companyId;

      if (id === actorId && nextRole !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('You cannot remove your own super admin access.');
      }
      if (nextRole === UserRole.SUPER_ADMIN && nextCompanyId !== null) {
        throw new BadRequestException(
          'A super admin cannot belong to a company — clear the company assignment when promoting to super admin.',
        );
      }
      if (nextRole !== UserRole.SUPER_ADMIN && !nextCompanyId) {
        throw new BadRequestException('A company must be assigned for this role.');
      }

      const companyChanged = nextCompanyId !== user.companyId;
      let companyName: string | null = null;

      if (nextCompanyId) {
        if (companyChanged) {
          const company = await this.lockCompanyForSeatCheck(queryRunner, nextCompanyId);
          await this.assertSeatAvailable(queryRunner, company);
          companyName = company.name;
        } else {
          companyName = (await queryRunner.manager.findOne(Company, { where: { id: nextCompanyId } }))?.name ?? null;
        }
      }

      if (input.email !== undefined) user.email = input.email;
      user.role = nextRole;
      user.companyId = nextCompanyId;
      await queryRunner.manager.save(user);

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'user.updated',
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email, role: user.role, companyId: user.companyId },
      });

      await queryRunner.commitTransaction();
      const session = await this.sessions.findOne({ where: { userId: user.id } });
      return toUserSummary(user, companyName, session);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async deactivate(id: string, actorId: string): Promise<UserSummary> {
    if (id === actorId) throw new ForbiddenException('You cannot deactivate your own account.');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.findOne(User, { where: { id } });
      if (!user) throw new NotFoundException('User not found.');
      if (user.status === UserStatus.INACTIVE) {
        throw new BadRequestException('User is already inactive.');
      }

      user.status = UserStatus.INACTIVE;
      await queryRunner.manager.save(user);

      // Logged out immediately, same as archiving a company — not left
      // to wait for their token to expire or their next refresh attempt
      // to fail.
      await queryRunner.query(`DELETE FROM "sessions" WHERE "user_id" = $1`, [id]);

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'user.deactivated',
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email },
      });

      await queryRunner.commitTransaction();
      const companyName = await this.companyNameFor(user.companyId);
      return toUserSummary(user, companyName, null);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async reactivate(id: string, actorId: string): Promise<UserSummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.findOne(User, { where: { id } });
      if (!user) throw new NotFoundException('User not found.');
      if (user.status === UserStatus.ACTIVE) {
        throw new BadRequestException('User is already active.');
      }

      user.status = UserStatus.ACTIVE;
      await queryRunner.manager.save(user);

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'user.reactivated',
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email },
      });

      await queryRunner.commitTransaction();
      const companyName = await this.companyNameFor(user.companyId);
      return toUserSummary(user, companyName, null);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async resetPassword(id: string, newPassword: string, actorId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.findOne(User, { where: { id } });
      if (!user) throw new NotFoundException('User not found.');

      user.passwordHash = await this.passwordService.hash(newPassword);
      await queryRunner.manager.save(user);

      // A reset is often a response to a compromised account — revoke
      // any existing session so the new password is required
      // immediately, not just on the next natural re-login.
      await queryRunner.query(`DELETE FROM "sessions" WHERE "user_id" = $1`, [id]);

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'user.password_reset',
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email },
      });

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async endSession(id: string, actorId: string): Promise<void> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found.');

    await this.sessions.delete({ userId: id });

    await this.auditLog.record(this.dataSource.manager, {
      actorUserId: actorId,
      action: 'user.session_ended',
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email },
    });
  }

  async remove(id: string, confirmEmail: string, actorId: string): Promise<void> {
    if (id === actorId) throw new ForbiddenException('You cannot delete your own account.');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.findOne(User, { where: { id } });
      if (!user) throw new NotFoundException('User not found.');
      if (confirmEmail !== user.email) {
        throw new BadRequestException('Email confirmation does not match.');
      }

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'user.deleted',
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email, role: user.role, companyId: user.companyId },
      });

      // Session cascades automatically (sessions.user_id ON DELETE CASCADE).
      await queryRunner.manager.delete(User, { id: user.id });

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async companyNameFor(companyId: string | null): Promise<string | null> {
    if (!companyId) return null;
    const company = await this.companies.findOne({ where: { id: companyId } });
    return company?.name ?? null;
  }

  // Locks the company row so a concurrent create/move against the same
  // company can't also pass the seat count check before either commits —
  // the second transaction blocks here until the first releases the
  // lock, by which point the count reflects the first insert. A
  // client-side check alone is not enforcement; this is.
  private async lockCompanyForSeatCheck(
    queryRunner: QueryRunner,
    companyId: string,
  ): Promise<CompanyLockRow> {
    const rows = (await queryRunner.query(
      `SELECT id, name, max_users AS "maxUsers" FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId],
    )) as CompanyLockRow[];
    const company = rows[0];
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  private async assertSeatAvailable(
    queryRunner: QueryRunner,
    company: CompanyLockRow,
  ): Promise<void> {
    const [{ count }] = (await queryRunner.query(`SELECT COUNT(*)::int AS count FROM users WHERE company_id = $1`, [
      company.id,
    ])) as Array<{ count: number }>;
    if (count >= company.maxUsers) {
      throw new BadRequestException(`"${company.name}" is at its seat limit.`);
    }
  }
}

function toUserSummary(user: User, companyName: string | null, session: Session | null): UserSummary {
  const online = !!session && session.expiresAt.getTime() > Date.now();
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    companyId: user.companyId,
    companyName,
    createdAt: user.createdAt.toISOString(),
    online,
    lastActiveAt: session ? session.createdAt.toISOString() : null,
  };
}
