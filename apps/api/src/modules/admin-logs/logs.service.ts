import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import type {
  ActivityLogEntry,
  AuditLogEntry,
  PaginatedResult,
} from '@repo/types/logs';
import { AdminAuditLog } from '../../database/control-plane/entities/admin-audit-log.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';

export interface LogsDateRange {
  from?: string;
  to?: string;
}

// `from`/`to` are calendar dates (YYYY-MM-DD); widened to the full day in
// UTC so "filter to Aug 8" includes every entry created on Aug 8,
// regardless of time of day.
function createdAtFilter(range: LogsDateRange) {
  const from = range.from ? new Date(`${range.from}T00:00:00.000Z`) : undefined;
  const to = range.to ? new Date(`${range.to}T23:59:59.999Z`) : undefined;
  if (from && to) return Between(from, to);
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThanOrEqual(to);
  return undefined;
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
  ): Promise<PaginatedResult<ActivityLogEntry>> {
    const where: FindOptionsWhere<BillingRecord> = {};
    const createdAt = createdAtFilter(range);
    if (createdAt) where.createdAt = createdAt;

    const [records, total] = await this.billing.findAndCount({
      where,
      relations: { company: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

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
  ): Promise<PaginatedResult<AuditLogEntry>> {
    const where: FindOptionsWhere<AdminAuditLog> = {};
    const createdAt = createdAtFilter(range);
    if (createdAt) where.createdAt = createdAt;

    const [records, total] = await this.auditLogs.findAndCount({
      where,
      relations: { actor: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

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
