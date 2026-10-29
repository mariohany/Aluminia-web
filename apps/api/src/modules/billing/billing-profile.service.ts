import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { FilePurpose } from '@repo/types/files';
import type {
  BillingDocumentKind,
  BillingProfile,
  UpdateBillingProfileInput,
} from '@repo/types/billing-profile';
import { cairoDateOf } from '@repo/types/subscriptions';
import { BillingProfileRow } from '../../database/control-plane/entities/billing-profile.entity';
import { BillingCounter } from '../../database/control-plane/entities/billing-counter.entity';
import { rollbackQuietly } from '../../database/rollback';
import { AuditLogService } from '../audit-log/audit-log.service';
import { FilesService } from '../files/files.service';

// Compared to decide what changed (and logged as such).
const DETAILS = [
  'legalNameEn',
  'legalNameAr',
  'addressEn',
  'addressAr',
  'taxId',
  'commercialRegister',
  'billingEmail',
  'phone',
  'bankAccount',
  'instapay',
  'logoFileId',
] as const;

/** The Cairo year documents are numbered in right now (B17). */
export function billingYear(now = new Date()): number {
  return Number(cairoDateOf(now).slice(0, 4));
}

/**
 * Billing › Billing profile (docs/subscriptions_planing.md B17, §3e): the
 * seller on every quotation and invoice, and where this year's numbers go
 * on. A next number can only go up: a number once issued is never reused.
 * The logo is a platform file (purpose billing_logo), attached like the
 * company logo: a new one in the same transaction, the old one released
 * after the commit.
 */
@Injectable()
export class BillingProfileService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly files: FilesService,
    private readonly auditLog: AuditLogService,
  ) {}

  async get(): Promise<BillingProfile> {
    return this.read(this.dataSource.manager);
  }

  async update(
    input: UpdateBillingProfileInput,
    actorId: string,
  ): Promise<BillingProfile> {
    const year = billingYear();
    let attached: string | null = null;
    let replaced: string | null = null;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const manager = queryRunner.manager;
      const row = await manager.findOne(BillingProfileRow, {
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      });
      const before = row ? pickDetails(row) : null;

      if (input.logoFileId !== (row?.logoFileId ?? null)) {
        if (input.logoFileId) {
          await this.files.attach(
            null,
            input.logoFileId,
            FilePurpose.BILLING_LOGO,
          );
          attached = input.logoFileId;
        }
        replaced = row?.logoFileId ?? null;
      }

      const { nextQuotation, nextInvoice, ...details } = input;
      await manager.save(BillingProfileRow, {
        id: 1,
        ...details,
        updatedBy: actorId,
      });

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of DETAILS) {
        const from = before?.[field] ?? null;
        if (from !== details[field]) {
          changes[field] = { from, to: details[field] };
        }
      }
      for (const [kind, next] of [
        ['quotation', nextQuotation],
        ['invoice', nextInvoice],
      ] as const) {
        if (next === undefined) continue;
        const from = await moveCounter(manager, kind, year, next);
        if (from !== next) {
          changes[`next_${kind}`] = { from, to: next };
        }
      }

      if (Object.keys(changes).length) {
        await this.auditLog.record(manager, {
          actorUserId: actorId,
          action: 'billing.profile_updated',
          targetType: 'billing_profile',
          targetId: null,
          metadata: { changes },
        });
      }
      await queryRunner.commitTransaction();
    } catch (error) {
      await rollbackQuietly(queryRunner);
      if (attached) await this.files.detach(null, attached);
      throw error;
    } finally {
      await queryRunner.release();
    }

    if (replaced) await this.files.release(null, replaced);
    return this.get();
  }

  private async read(manager: EntityManager): Promise<BillingProfile> {
    const year = billingYear();
    const row = await manager.findOne(BillingProfileRow, { where: { id: 1 } });
    const counters = await manager.find(BillingCounter, { where: { year } });
    const last = (kind: BillingDocumentKind) =>
      counters.find((c) => c.kind === kind)?.last ?? 0;
    return {
      details: row ? pickDetails(row) : null,
      numbering: {
        year,
        nextQuotation: last('quotation') + 1,
        nextInvoice: last('invoice') + 1,
      },
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
}

/**
 * Sets this year's next number for `kind` (only upwards; 400
 * `number_too_low` otherwise) and returns the next number it had. The
 * counter row is locked, like the issuing of a number in step 6.
 */
async function moveCounter(
  manager: EntityManager,
  kind: BillingDocumentKind,
  year: number,
  next: number,
): Promise<number> {
  await manager
    .createQueryBuilder()
    .insert()
    .into(BillingCounter)
    .values({ kind, year, last: 0 })
    .orIgnore()
    .execute();
  const counter = await manager.findOneOrFail(BillingCounter, {
    where: { kind, year },
    lock: { mode: 'pessimistic_write' },
  });
  const current = counter.last + 1;
  if (next < current) {
    throw new BadRequestException({
      message: `The next ${kind} number can't go below ${current}.`,
      code: 'number_too_low',
    });
  }
  if (next !== current) {
    counter.last = next - 1;
    await manager.save(counter);
  }
  return current;
}

function pickDetails(
  row: BillingProfileRow,
): NonNullable<BillingProfile['details']> {
  return {
    legalNameEn: row.legalNameEn,
    legalNameAr: row.legalNameAr,
    addressEn: row.addressEn,
    addressAr: row.addressAr,
    taxId: row.taxId,
    commercialRegister: row.commercialRegister,
    billingEmail: row.billingEmail,
    phone: row.phone,
    bankAccount: row.bankAccount,
    instapay: row.instapay,
    logoFileId: row.logoFileId,
  };
}
