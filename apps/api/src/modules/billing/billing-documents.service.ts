import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, type EntityManager } from 'typeorm';
import {
  documentStatus,
  documentTotals,
  type BillingDocumentSummary,
  type DocumentParty,
  type MarkPaidInput,
  type QuotationInput,
  type TransactionsPage,
  type TransactionsQuery,
  type TransactionsSummary,
} from '@repo/types/billing-documents';
import {
  documentNumber,
  type BillingDocumentKind,
} from '@repo/types/billing-profile';
import {
  addDays,
  cairoDateOf,
  daysBetween,
  endOfCairoDay,
} from '@repo/types/subscriptions';
import { BillingDocument } from '../../database/control-plane/entities/billing-document.entity';
import { BillingProfileRow } from '../../database/control-plane/entities/billing-profile.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import { Company } from '../../database/control-plane/entities/company.entity';
import { Plan } from '../../database/control-plane/entities/plan.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { CompanyProfileRow } from '../../database/tenant/entities/company-profile.entity';
import { rollbackQuietly } from '../../database/rollback';
import { AuditLogService } from '../audit-log/audit-log.service';
import { toPlanRef } from '../plans/plans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantConnectionService } from '../tenancy/tenant-connection.service';
import { billingYear } from './billing-profile.service';

/** Transactions CSV: at most this many rows per export. */
const CSV_LIMIT = 10_000;

/**
 * Quotations and invoices (docs/subscriptions_planing.md §3d, §4d).
 *
 * - A quotation gets its QUO number when saved, as a draft; only a draft
 *   can be edited; a draft or sent one can be voided.
 * - Totals are always rebuilt here from the inputs (`documentTotals`).
 * - Seller (Billing profile) and buyer (company names + its profile's
 *   address and registration) are snapshotted on the document.
 * - Mark paid, in one transaction: the next INV number (counter locked,
 *   no gaps), the invoice (a copy, marked paid), the quotation paid, and the
 *   company renewed (B8: the day after an active paid plan's end, else the
 *   payment day; the quotation's length kept). An expired quotation can't
 *   be paid (Q3).
 */
@Injectable()
export class BillingDocumentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tenants: TenantConnectionService,
    private readonly subscriptions: SubscriptionsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listForCompany(companyId: string): Promise<BillingDocumentSummary[]> {
    const rows = await this.baseQuery(this.dataSource.manager)
      .where('doc.company_id = :companyId', { companyId })
      .orderBy('doc.createdAt', 'DESC')
      .addOrderBy('doc.id', 'DESC')
      .getMany();
    return this.summaries(rows);
  }

  async get(id: string): Promise<BillingDocumentSummary> {
    const row = await this.baseQuery(this.dataSource.manager)
      .where('doc.id = :id', { id })
      .getOne();
    if (!row) throw new NotFoundException('Document not found.');
    return (await this.summaries([row]))[0];
  }

  async createQuotation(
    companyId: string,
    input: QuotationInput,
    actorId: string,
  ): Promise<BillingDocumentSummary> {
    const company = await this.dataSource.manager.findOne(Company, {
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found.');
    const buyer = await this.buyerOf(company);

    const id = await this.inTransaction(async (manager) => {
      const seller = await sellerOf(manager);
      const plan = await manager.findOneOrFail(Plan, {
        where: { key: input.planKey },
      });
      const number = await takeNumber(manager, 'quotation');
      const doc = manager.create(BillingDocument, {
        companyId,
        kind: 'quotation',
        number,
        status: 'draft',
        quotationId: null,
        createdBy: actorId,
        ...fieldsOf(input, plan),
        seller,
        buyer,
      });
      await manager.save(doc);
      await this.auditLog.record(manager, {
        actorUserId: actorId,
        action: 'billing.quotation_created',
        targetType: 'company',
        targetId: companyId,
        metadata: {
          name: company.name,
          number,
          total: doc.total,
          currency: doc.currency,
        },
      });
      return doc.id;
    });
    return this.get(id);
  }

  async updateQuotation(
    id: string,
    input: QuotationInput,
    actorId: string,
  ): Promise<BillingDocumentSummary> {
    const current = await this.dataSource.manager.findOne(BillingDocument, {
      where: { id },
      relations: { company: true },
    });
    if (!current) throw new NotFoundException('Document not found.');
    const buyer = await this.buyerOf(current.company!);

    await this.inTransaction(async (manager) => {
      const doc = await lockDocument(manager, id);
      if (doc.kind !== 'quotation' || doc.status !== 'draft') {
        throw new ConflictException({
          message: 'Only a draft quotation can be edited.',
          code: 'not_editable',
        });
      }
      const plan = await manager.findOneOrFail(Plan, {
        where: { key: input.planKey },
      });
      Object.assign(doc, fieldsOf(input, plan), {
        seller: await sellerOf(manager),
        buyer,
      });
      await manager.save(doc);
      await this.auditLog.record(manager, {
        actorUserId: actorId,
        action: 'billing.quotation_updated',
        targetType: 'company',
        targetId: doc.companyId,
        metadata: { name: current.company!.name, number: doc.number },
      });
    });
    return this.get(id);
  }

  async voidQuotation(
    id: string,
    actorId: string,
  ): Promise<BillingDocumentSummary> {
    await this.inTransaction(async (manager) => {
      const doc = await lockDocument(manager, id);
      if (
        doc.kind !== 'quotation' ||
        (doc.status !== 'draft' && doc.status !== 'sent')
      ) {
        throw new ConflictException({
          message: 'Only an unpaid quotation can be voided.',
          code: 'not_voidable',
        });
      }
      doc.status = 'void';
      await manager.save(doc);
      await this.auditLog.record(manager, {
        actorUserId: actorId,
        action: 'billing.quotation_voided',
        targetType: 'company',
        targetId: doc.companyId,
        metadata: { number: doc.number },
      });
    });
    return this.get(id);
  }

  async markPaid(
    id: string,
    input: MarkPaidInput,
    actorId: string,
  ): Promise<BillingDocumentSummary> {
    const invoiceId = await this.inTransaction(async (manager) => {
      const quotation = await lockDocument(manager, id);
      if (
        quotation.kind !== 'quotation' ||
        (quotation.status !== 'draft' && quotation.status !== 'sent')
      ) {
        throw new ConflictException({
          message: 'Only an unpaid quotation can be marked paid.',
          code: 'not_payable',
        });
      }
      const today = cairoDateOf(new Date());
      if (
        documentStatus(quotation.status, quotation.validUntil, today) ===
        'expired'
      ) {
        throw new ConflictException({
          message: 'This quotation has expired; issue a new one.',
          code: 'quotation_expired',
        });
      }

      // Same row lock as Edit subscription and the seat check in
      // UsersService.
      const company = await manager.findOneOrFail(Company, {
        where: { id: quotation.companyId },
        lock: { mode: 'pessimistic_write' },
      });
      const previous = await manager.findOneOrFail(Plan, {
        where: { id: company.planId },
      });
      const userCount = await manager.count(User, {
        where: { companyId: company.id },
      });
      if (quotation.seats < userCount) {
        throw new BadRequestException({
          message: `"${company.name}" has ${userCount} users; remove some or quote ${userCount} seats.`,
          code: 'seats_below_users',
        });
      }

      // B8: an active paid plan renews from the day after its end; Free,
      // a trial or an ended plan from the payment day.
      const activePaid =
        previous.key !== 'free' &&
        !company.isTrial &&
        company.endsAt !== null &&
        company.endsAt.getTime() > Date.now();
      const startsOn = activePaid
        ? addDays(cairoDateOf(company.endsAt!), 1)
        : input.paidOn;
      const endsOn = addDays(
        startsOn,
        daysBetween(quotation.startsOn, quotation.endsOn),
      );

      const number = await takeNumber(manager, 'invoice');
      const invoice = manager.create(BillingDocument, {
        ...copyOf(quotation),
        kind: 'invoice',
        number,
        status: 'paid',
        quotationId: quotation.id,
        startsOn,
        endsOn,
        validUntil: null,
        paidOn: input.paidOn,
        amountReceived: input.amountReceived,
        paymentMethod: input.method,
        paymentReference: input.reference,
        createdBy: actorId,
      });
      await manager.save(invoice);
      quotation.status = 'paid';
      await manager.save(quotation);

      if (previous.key === 'free') {
        await this.subscriptions.restoreFromFree(manager, company.id);
      }
      Object.assign(company, {
        planId: quotation.planId,
        maxUsers: quotation.seats,
        endsAt: endOfCairoDay(endsOn),
        isTrial: false,
        freeProjectId: null,
      });
      await manager.save(company);
      await manager.insert(BillingRecord, {
        companyId: company.id,
        planId: quotation.planId,
        maxUsers: company.maxUsers,
        endsAt: company.endsAt,
        isTrial: false,
        reason: 'paid',
        documentId: invoice.id,
        notes: null,
        actorId,
      });
      await this.auditLog.record(manager, {
        actorUserId: actorId,
        action: 'billing.paid',
        targetType: 'company',
        targetId: company.id,
        metadata: {
          name: company.name,
          quotation: quotation.number,
          invoice: number,
          total: invoice.total,
          currency: invoice.currency,
          endsOn,
        },
      });
      return invoice.id;
    });
    return this.get(invoiceId);
  }

  // ---- Transactions (B21) ----

  async transactions(query: TransactionsQuery): Promise<TransactionsPage> {
    const qb = this.filtered(query);
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('doc.created_at < :at', { at: cursor.at }).orWhere(
            'doc.created_at = :at AND doc.id < :cid',
            { at: cursor.at, cid: cursor.id },
          );
        }),
      );
    }
    const rows = await qb.take(query.limit + 1).getMany();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.summaries(page),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  async summary(now = new Date()): Promise<TransactionsSummary> {
    const today = cairoDateOf(now);
    const [row] = await this.dataSource.query<
      Array<Record<string, string | null>>
    >(
      `SELECT
         COALESCE(SUM(total_egp) FILTER (WHERE kind = 'invoice' AND to_char(paid_on, 'YYYY-MM') = $1), 0) AS month,
         COALESCE(SUM(total_egp) FILTER (WHERE kind = 'invoice' AND to_char(paid_on, 'YYYY') = $2), 0) AS year,
         COALESCE(SUM(total_egp) FILTER (WHERE kind = 'quotation' AND status = 'sent' AND (valid_until IS NULL OR valid_until >= $3)), 0) AS unpaid,
         COUNT(*) FILTER (WHERE kind = 'quotation' AND status = 'sent' AND (valid_until IS NULL OR valid_until >= $3)) AS unpaid_count,
         COUNT(*) FILTER (WHERE kind = 'quotation' AND status = 'draft' AND (valid_until IS NULL OR valid_until >= $3)) AS drafts
       FROM billing_documents`,
      [today.slice(0, 7), today.slice(0, 4), today],
    );
    return {
      receivedThisMonthEgp: Number(row?.month ?? 0),
      receivedThisYearEgp: Number(row?.year ?? 0),
      unpaidEgp: Number(row?.unpaid ?? 0),
      unpaidCount: Number(row?.unpaid_count ?? 0),
      draftCount: Number(row?.drafts ?? 0),
    };
  }

  async csv(query: TransactionsQuery): Promise<string> {
    const rows = await this.filtered(query).take(CSV_LIMIT).getMany();
    const items = await this.summaries(rows);
    const header = [
      'Number',
      'Kind',
      'Status',
      'Company',
      'Plan',
      'Seats',
      'Starts',
      'Ends',
      'Currency',
      'Total',
      'Total EGP',
      'Created',
      'Paid on',
      'Method',
      'Reference',
    ];
    const lines = items.map((d) =>
      [
        d.number,
        d.kind,
        d.status,
        d.company.name,
        d.plan.nameEn,
        d.seats,
        d.startsOn,
        d.endsOn,
        d.currency,
        d.totals.total.toFixed(2),
        d.totals.totalEgp.toFixed(2),
        d.createdAt.slice(0, 10),
        d.paidOn ?? '',
        d.paymentMethod ?? '',
        d.paymentReference ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
    // A BOM so Excel reads the Arabic names as UTF-8.
    return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  // ---- helpers ----

  private filtered(query: TransactionsQuery) {
    const today = cairoDateOf(new Date());
    const qb = this.baseQuery(this.dataSource.manager)
      .orderBy('doc.createdAt', 'DESC')
      .addOrderBy('doc.id', 'DESC');
    if (query.kind) qb.andWhere('doc.kind = :kind', { kind: query.kind });
    if (query.companyId) {
      qb.andWhere('doc.company_id = :companyId', {
        companyId: query.companyId,
      });
    }
    if (query.from) {
      qb.andWhere(`doc.created_at >= :from`, {
        from: new Date(endOfCairoDay(addDays(query.from, -1)).getTime() + 1000),
      });
    }
    if (query.to) {
      qb.andWhere('doc.created_at <= :to', { to: endOfCairoDay(query.to) });
    }
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('doc.number ILIKE :search')
            .orWhere('company.name ILIKE :search')
            .orWhere('company.name_ar ILIKE :search');
        }),
        { search: `%${escapeLike(query.search)}%` },
      );
    }
    const unexpired = '(doc.valid_until IS NULL OR doc.valid_until >= :today)';
    switch (query.status) {
      case 'expired':
        qb.andWhere(
          `doc.status IN ('draft', 'sent') AND doc.valid_until < :today`,
          { today },
        );
        break;
      case 'draft':
      case 'sent':
        qb.andWhere(`doc.status = :status AND ${unexpired}`, {
          status: query.status,
          today,
        });
        break;
      case 'paid':
      case 'void':
        qb.andWhere('doc.status = :status', { status: query.status });
        break;
    }
    return qb;
  }

  private baseQuery(manager: EntityManager) {
    return manager
      .createQueryBuilder(BillingDocument, 'doc')
      .innerJoinAndSelect('doc.company', 'company')
      .innerJoinAndSelect('doc.plan', 'plan')
      .leftJoinAndSelect('doc.creator', 'creator');
  }

  private async summaries(
    rows: BillingDocument[],
  ): Promise<BillingDocumentSummary[]> {
    const quotationIds = rows
      .filter((r) => r.kind === 'quotation')
      .map((r) => r.id);
    const invoices: Array<{ id: string; quotation_id: string }> =
      quotationIds.length
        ? await this.dataSource.query(
            `SELECT id, quotation_id FROM billing_documents WHERE quotation_id = ANY($1)`,
            [quotationIds],
          )
        : [];
    const today = cairoDateOf(new Date());
    return rows.map((doc) => ({
      id: doc.id,
      kind: doc.kind,
      number: doc.number,
      status: documentStatus(doc.status, doc.validUntil, today),
      company: {
        id: doc.companyId,
        name: doc.company!.name,
        nameAr: doc.company!.nameAr,
      },
      quotationId: doc.quotationId,
      invoiceId: invoices.find((i) => i.quotation_id === doc.id)?.id ?? null,
      plan: {
        ...toPlanRef(doc.plan!),
        nameEn: doc.planNameEn,
        nameAr: doc.planNameAr,
      },
      seats: doc.seats,
      months: doc.months,
      startsOn: doc.startsOn,
      endsOn: doc.endsOn,
      currency: doc.currency,
      fxRate: doc.fxRate,
      unitPrice: doc.unitPrice,
      discountKind: doc.discountKind,
      discountValue: doc.discountValue,
      vatRate: doc.vatRate,
      totals: {
        subtotal: doc.subtotal,
        discountAmount: doc.discountAmount,
        vatAmount: doc.vatAmount,
        total: doc.total,
        totalEgp: doc.totalEgp,
      },
      validUntil: doc.validUntil,
      note: doc.note,
      paidOn: doc.paidOn,
      amountReceived: doc.amountReceived,
      paymentMethod: doc.paymentMethod,
      paymentReference: doc.paymentReference,
      createdByEmail: doc.creator?.email ?? null,
      createdAt: doc.createdAt.toISOString(),
    }));
  }

  /** The company as the buyer: the super admin's names, the address and
   * registration from its own company profile. */
  private async buyerOf(company: Company): Promise<DocumentParty> {
    let profile: CompanyProfileRow | null = null;
    try {
      profile = await this.tenants.runInSchema(company.schemaName, (m) =>
        m.findOne(CompanyProfileRow, { where: { id: 1 } }),
      );
    } catch {
      // A company whose schema is gone still gets a document.
    }
    return {
      nameEn: profile?.enName || company.name,
      nameAr: profile?.arName || company.nameAr,
      addressEn: profile?.enAddress ?? null,
      addressAr: profile?.arAddress ?? null,
      taxId: profile?.taxId ?? null,
      commercialRegister: profile?.commercialRegister ?? null,
    };
  }

  private async inTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

/** The editable part of a quotation, with its totals rebuilt (§4d). */
function fieldsOf(input: QuotationInput, plan: Plan) {
  const totals = documentTotals(input);
  return {
    planId: plan.id,
    planNameEn: plan.nameEn,
    planNameAr: plan.nameAr,
    seats: input.seats,
    months: input.months,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    currency: input.currency,
    fxRate: input.fxRate,
    fxDate: input.fxRate === null ? null : cairoDateOf(new Date()),
    unitPrice: totals.subtotal,
    subtotal: totals.subtotal,
    discountKind: input.discountKind,
    discountValue: input.discountValue,
    discountAmount: totals.discountAmount,
    vatRate: input.vatRate,
    vatAmount: totals.vatAmount,
    total: totals.total,
    totalEgp: totals.totalEgp,
    validUntil: input.validUntil,
    note: input.note,
  };
}

/** What an invoice copies from its quotation. */
function copyOf(q: BillingDocument): Partial<BillingDocument> {
  return {
    companyId: q.companyId,
    planId: q.planId,
    planNameEn: q.planNameEn,
    planNameAr: q.planNameAr,
    seats: q.seats,
    months: q.months,
    currency: q.currency,
    fxRate: q.fxRate,
    fxDate: q.fxDate,
    unitPrice: q.unitPrice,
    subtotal: q.subtotal,
    discountKind: q.discountKind,
    discountValue: q.discountValue,
    discountAmount: q.discountAmount,
    vatRate: q.vatRate,
    vatAmount: q.vatAmount,
    total: q.total,
    totalEgp: q.totalEgp,
    note: q.note,
    seller: q.seller,
    buyer: q.buyer,
  };
}

async function lockDocument(
  manager: EntityManager,
  id: string,
): Promise<BillingDocument> {
  const doc = await manager.findOne(BillingDocument, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!doc) throw new NotFoundException('Document not found.');
  return doc;
}

/** The seller as issued (B17). Nothing is issued before the Billing
 * profile is saved: 409 `billing_profile_missing`. */
async function sellerOf(
  manager: EntityManager,
): Promise<DocumentParty & Record<string, unknown>> {
  const row = await manager.findOne(BillingProfileRow, { where: { id: 1 } });
  if (!row) {
    throw new ConflictException({
      message: 'Fill in the Billing profile first.',
      code: 'billing_profile_missing',
    });
  }
  return {
    nameEn: row.legalNameEn,
    nameAr: row.legalNameAr,
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

/** The next number of `kind` this year, the counter locked until commit,
 * so two pays never share one and a rollback leaves no gap (B17). */
async function takeNumber(
  manager: EntityManager,
  kind: BillingDocumentKind,
): Promise<string> {
  const year = billingYear();
  const [row] = await manager.query<Array<{ last: number }>>(
    `INSERT INTO billing_counters (kind, year, last) VALUES ($1, $2, 1)
     ON CONFLICT (kind, year) DO UPDATE SET last = billing_counters.last + 1
     RETURNING last`,
    [kind, year],
  );
  return documentNumber(kind, year, row.last);
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(
  cursor: string | undefined,
): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const date = new Date(at ?? '');
  if (!id || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new BadRequestException('Bad cursor.');
  }
  return { at: date, id };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function csvCell(value: string | number): string {
  const text = String(value);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
