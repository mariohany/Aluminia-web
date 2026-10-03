import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import type {
  ActivityLogEntry,
  AuditArea,
  AuditLogEntry,
  PaginatedResult,
} from '@repo/types/logs';
import { AdminAuditLog } from '../../database/control-plane/entities/admin-audit-log.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';

export interface LogsDateRange {
  from?: string;
  to?: string;
}

export interface AuditLogFilters {
  area?: AuditArea;
  actorId?: string;
  search?: string;
}

/** `%`, `_` and `\` are LIKE wildcards — a search for "50%" means the text. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// `from`/`to` are calendar dates (YYYY-MM-DD); widened to the full day in
// UTC so "filter to Aug 8" includes every entry created on Aug 8,
// regardless of time of day.
function applyCreatedAt(
  query: SelectQueryBuilder<ObjectLiteral>,
  alias: string,
  range: LogsDateRange,
): void {
  if (range.from) {
    query.andWhere(`${alias}.createdAt >= :from`, {
      from: new Date(`${range.from}T00:00:00.000Z`),
    });
  }
  if (range.to) {
    query.andWhere(`${alias}.createdAt <= :to`, {
      to: new Date(`${range.to}T23:59:59.999Z`),
    });
  }
}

@Injectable()
export class LogsService {
  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly auditLogs: Repository<AdminAuditLog>,
    @InjectRepository(BillingRecord)
    private readonly billing: Repository<BillingRecord>,
  ) {}

  async activityLog(
    page: number,
    pageSize: number,
    range: LogsDateRange,
    search?: string,
  ): Promise<PaginatedResult<ActivityLogEntry>> {
    const query = this.billing
      .createQueryBuilder('record')
      .innerJoinAndSelect('record.company', 'company')
      .orderBy('record.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    applyCreatedAt(query, 'record', range);
    if (search) {
      query.andWhere(`company.name ILIKE :search ESCAPE '\\'`, {
        search: likePattern(search),
      });
    }
    const [records, total] = await query.getManyAndCount();

    return {
      // `company` is guaranteed present: billing.company_id cascades on
      // company delete, so a surviving billing row always has its company.
      items: records.map((record) => ({
        id: record.id,
        companyId: record.companyId,
        companyName: record.company!.name,
        plan: record.plan,
        maxUsers: record.maxUsers,
        notes: record.notes,
        effectiveFrom: record.effectiveFrom.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async auditLog(
    page: number,
    pageSize: number,
    range: LogsDateRange,
    filters: AuditLogFilters = {},
  ): Promise<PaginatedResult<AuditLogEntry>> {
    const query = this.auditLogs
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actor', 'actor')
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    applyCreatedAt(query, 'log', range);
    if (filters.area) {
      // Areas are a fixed enum (logsQuerySchema), so the prefix is safe
      // to build; it's still bound, not interpolated.
      query.andWhere('log.action LIKE :area', { area: `${filters.area}.%` });
    }
    if (filters.actorId) {
      query.andWhere('log.actorUserId = :actorId', {
        actorId: filters.actorId,
      });
    }
    if (filters.search) {
      // What the entry was about: a company or catalogue row's name, a
      // user's email, a lead's company — whichever the action recorded.
      query.andWhere(
        `(log.metadata ->> 'name' ILIKE :search ESCAPE '\\'
          OR log.metadata ->> 'email' ILIKE :search ESCAPE '\\'
          OR log.metadata ->> 'companyName' ILIKE :search ESCAPE '\\')`,
        { search: likePattern(filters.search) },
      );
    }
    const [records, total] = await query.getManyAndCount();

    return {
      items: records.map((record) => ({
        id: record.id,
        actorUserId: record.actorUserId,
        actorEmail: record.actor?.email ?? null,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        metadata: record.metadata,
        createdAt: record.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}
