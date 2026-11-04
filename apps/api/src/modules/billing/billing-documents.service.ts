import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { UserRole } from '@repo/types/auth';
import { Brackets, DataSource, type EntityManager } from 'typeorm';
import {
  documentStatus,
  documentTotals,
  round2,
  unusedCredit,
  upgradeHasCredit,
  upgradePeriod,
  type BillingDocumentSummary,
  type CreditLine,
  type DocumentParty,
  type DocumentSeller,
  type MarkPaidInput,
  type VoidQuotationInput,
  type QuotationInput,
  type SendDocumentInput,
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
import { MAX_PLAN_SEATS } from '@repo/types/plans';
import { BillingDocument } from '../../database/control-plane/entities/billing-document.entity';
import { BillingSend } from '../../database/control-plane/entities/billing-send.entity';
import { BillingProfileRow } from '../../database/control-plane/entities/billing-profile.entity';
import {
  BillingRecord,
  type PreviousSubscription,
} from '../../database/control-plane/entities/billing-record.entity';
import { Company } from '../../database/control-plane/entities/company.entity';
import { Plan } from '../../database/control-plane/entities/plan.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { CompanyProfileRow } from '../../database/tenant/entities/company-profile.entity';
import { rollbackQuietly } from '../../database/rollback';
import { MAILER, type Mailer } from '../../mail/mailer';
import { documentEmail } from '../../mail/templates';
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
    @Inject(MAILER) private readonly mailer: Mailer,
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
      const terms = await termsOf(manager, company, input, plan);
      const number = await takeNumber(manager, 'quotation');
      const doc = manager.create(BillingDocument, {
        companyId,
        kind: 'quotation',
        number,
        status: 'draft',
        quotationId: null,
        createdBy: actorId,
        ...fieldsOf(input, plan, terms),
        seller,
        buyer,
      });
      await manager.save(doc);
      await rememberPricing(manager, companyId, input);
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
      const terms = await termsOf(manager, current.company!, input, plan);
      Object.assign(doc, fieldsOf(input, plan, terms), {
        seller: await sellerOf(manager),
        buyer,
      });
      await manager.save(doc);
      await rememberPricing(manager, doc.companyId, input);
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
    input: VoidQuotationInput,
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
      doc.voidReason = input.reason || null;
      await manager.save(doc);
      await this.auditLog.record(manager, {
        actorUserId: actorId,
        action: 'billing.quotation_voided',
        targetType: 'company',
        targetId: doc.companyId,
        metadata: { number: doc.number, reason: doc.voidReason },
      });
    });
    return this.get(id);
  }

  /**
   * Who gets a document by default: whoever got it (or its quotation)
   * last, else the company's active admins.
   */
  async recipientsOf(doc: BillingDocumentSummary): Promise<string[]> {
    if (doc.lastSent) return doc.lastSent.to;
    if (doc.quotationId) {
      const quotation = await this.get(doc.quotationId);
      if (quotation.lastSent) return quotation.lastSent.to;
    }
    const admins: Array<{ email: string }> = await this.dataSource.query(
      `SELECT "email" FROM "users" WHERE "company_id" = $1 AND "role" = $2 AND "status" = 'active' ORDER BY "created_at"`,
      [doc.company.id, UserRole.COMPANY_ADMIN],
    );
    return admins.map((a) => a.email);
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
      // P14: an expired quotation can still be paid, after a warning.
      if (
        documentStatus(quotation.status, quotation.validUntil, today) ===
          'expired' &&
        !input.acknowledgeExpired
      ) {
        throw new ConflictException({
          message: 'This quotation has expired. Record the payment anyway?',
          code: 'quotation_expired',
        });
      }
      if (input.paidOn > today) {
        throw new BadRequestException({
          message: 'The money can’t have arrived after today.',
          code: 'paid_in_future',
        });
      }
      // P12: a different amount is recorded as it arrived, with a note.
      const note = input.note?.trim() || null;
      if (round2(input.amountReceived) !== quotation.total && !note) {
        throw new BadRequestException({
          message: `The amount differs from the total ${quotation.total}: say why in the note.`,
          code: 'note_required',
        });
      }
      // §6: a reference is used once per method.
      const reused: Array<{ number: string }> = await manager.query(
        `SELECT "number" FROM "billing_documents"
         WHERE "kind" = 'invoice' AND "payment_method" = $1 AND lower("payment_reference") = lower($2)`,
        [input.method, input.reference.trim()],
      );
      if (reused.length > 0) {
        throw new ConflictException({
          message: `This reference is already on ${reused[0].number}.`,
          code: 'reference_used',
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

      const activePaid =
        previous.key !== 'free' &&
        !company.isTrial &&
        company.endsAt !== null &&
        company.endsAt.getTime() > Date.now();
      let startsOn: string;
      let endsOn: string;
      if (quotation.purpose === 'upgrade') {
        // P11: plan and seats switch now; the quoted end is kept (the
        // current end, or a longer period's). Its credit assumed the paid
        // plan still runs.
        if (!activePaid || quotation.endsOn < today) {
          throw new ConflictException({
            message: `"${company.name}" is no longer on the plan this upgrade was quoted for; void it and issue a new quotation.`,
            code: 'upgrade_outdated',
          });
        }
        startsOn = input.paidOn;
        endsOn = quotation.endsOn;
      } else {
        // B8: an active paid plan renews from the day after its end; Free,
        // a trial or an ended plan from the payment day.
        startsOn = activePaid
          ? addDays(cairoDateOf(company.endsAt!), 1)
          : input.paidOn;
        endsOn = addDays(
          startsOn,
          daysBetween(quotation.startsOn, quotation.endsOn),
        );
      }

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
        paymentReference: input.reference.trim(),
        paymentNote: note,
        paymentRecordedAt: new Date(),
        createdBy: actorId,
      });
      await manager.save(invoice);
      quotation.status = 'paid';
      await manager.save(quotation);

      // P22: what the same-day undo puts back.
      const before: PreviousSubscription = {
        planId: company.planId,
        maxUsers: company.maxUsers,
        endsAt: company.endsAt?.toISOString() ?? null,
        isTrial: company.isTrial,
        freeProjectId: company.freeProjectId,
        reactivatedUserIds: [],
      };
      if (previous.key === 'free') {
        before.reactivatedUserIds = await this.subscriptions.restoreFromFree(
          manager,
          company.id,
        );
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
        previous: before,
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
    }).catch((error: unknown) => {
      // Two payments with one reference at the same moment: the index decides.
      if (isUniqueViolation(error, 'UQ_billing_documents_payment_reference')) {
        throw new ConflictException({
          message: 'This reference is already on another invoice.',
          code: 'reference_used',
        });
      }
      throw error;
    });
    return this.get(invoiceId);
  }

  /**
   * Emails a quotation or invoice (B16, §6b) with the PDF the browser drew
   * (Q1). Every attempt is recorded in `billing_sends`, a failure too, and
   * a failure is answered 502 `mail_failed`, never retried silently. A
   * draft quotation becomes `sent`.
   */
  async send(
    id: string,
    input: SendDocumentInput,
    actorId: string,
  ): Promise<BillingDocumentSummary> {
    const doc = await this.get(id);
    if (doc.status === 'void') {
      throw new ConflictException({
        message: 'A void quotation is not sent.',
        code: 'not_sendable',
      });
    }
    const pdf = Buffer.from(input.pdfBase64, 'base64');
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('The attachment is not a PDF.');
    }
    const to = [...new Set(input.to.map((e) => e.toLowerCase()))];
    const actor = await this.dataSource.manager.findOne(User, {
      where: { id: actorId },
    });
    const copy =
      input.copyMe && actor && !to.includes(actor.email.toLowerCase())
        ? [actor.email]
        : [];

    let messageId: string | null = null;
    let error: string | null = null;
    try {
      ({ messageId } = await this.mailer.send({
        to,
        bcc: copy,
        ...documentEmail(doc, input.subject),
        attachments: [
          { name: `${doc.number}.pdf`, contentBase64: pdf.toString('base64') },
        ],
      }));
    } catch (err) {
      error = (err as Error).message.slice(0, 1000);
    }

    await this.inTransaction(async (manager) => {
      await manager.insert(BillingSend, {
        documentId: id,
        to,
        subject: input.subject,
        copyToMe: input.copyMe,
        providerMessageId: messageId,
        error,
        sentBy: actorId,
      });
      if (error) return;
      await manager.update(
        BillingDocument,
        { id, kind: 'quotation', status: 'draft' },
        { status: 'sent' },
      );
      await this.auditLog.record(manager, {
        actorUserId: actorId,
        action: 'billing.document_sent',
        targetType: 'company',
        targetId: doc.company.id,
        metadata: {
          name: doc.company.name,
          number: doc.number,
          count: to.length,
        },
      });
    });
    if (error) {
      throw new BadGatewayException({
        message: `The email was not sent: ${error}`,
        code: 'mail_failed',
      });
    }
    return this.get(id);
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
    // Each quotation's invoice, and each invoice's quotation number.
    const ids = rows.map((r) => r.id);
    const quotationIds = rows.flatMap((r) =>
      r.quotationId ? [r.quotationId] : [],
    );
    const linked: Array<{
      id: string;
      number: string;
      quotation_id: string | null;
    }> = ids.length
      ? await this.dataSource.query(
          `SELECT id, number, quotation_id FROM billing_documents
             WHERE quotation_id = ANY($1) OR id = ANY($2)`,
          [ids, quotationIds],
        )
      : [];
    const sends: Array<{ document_id: string; sent_at: Date; to: string[] }> =
      ids.length
        ? await this.dataSource.query(
            `SELECT DISTINCT ON (document_id) document_id, sent_at, "to"
             FROM billing_sends WHERE document_id = ANY($1) AND error IS NULL
             ORDER BY document_id, sent_at DESC`,
            [ids],
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
      quotationNumber:
        linked.find((l) => l.id === doc.quotationId)?.number ?? null,
      seller: doc.seller,
      buyer: doc.buyer,
      quotationId: doc.quotationId,
      invoiceId: linked.find((l) => l.quotation_id === doc.id)?.id ?? null,
      plan: {
        ...toPlanRef(doc.plan!),
        nameEn: doc.planNameEn,
        nameAr: doc.planNameAr,
      },
      purpose: doc.purpose,
      seats: doc.seats,
      extraSeats: doc.extraSeats,
      extraSeatPrice: doc.extraSeatPrice,
      credit: doc.creditLines,
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
        extraSeatsAmount: doc.extraSeatsAmount,
        discountAmount: doc.discountAmount,
        creditAmount: doc.creditAmount,
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
      paymentNote: doc.paymentNote,
      paymentRecordedAt: doc.paymentRecordedAt?.toISOString() ?? null,
      voidReason: doc.voidReason,
      createdByEmail: doc.creator?.email ?? null,
      createdAt: doc.createdAt.toISOString(),
      lastSent: lastSentOf(sends.find((x) => x.document_id === doc.id)),
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

/** What the API decides about a quotation, not the dialog. */
interface QuotationTerms {
  seats: number;
  startsOn: string;
  endsOn: string;
  creditLines: CreditLine[];
  creditAmount: number;
}

/**
 * Checks the type against the company (payment cycle P11, P16, P30) and
 * settles what the dialog can't: seats = plan + extra; an upgrade starts
 * today, keeps the end unless its length runs past it, and gets a credit
 * for the unused days of what was paid.
 */
async function termsOf(
  manager: EntityManager,
  company: Company,
  input: QuotationInput,
  plan: Plan,
): Promise<QuotationTerms> {
  const current = await manager.findOneOrFail(Plan, {
    where: { id: company.planId },
  });
  const onPaidPlan =
    current.key !== 'free' &&
    !company.isTrial &&
    company.endsAt !== null &&
    company.endsAt.getTime() > Date.now();
  if ((input.purpose === 'new') === onPaidPlan) {
    throw new ConflictException({
      message: onPaidPlan
        ? `"${company.name}" is on a paid plan: quote a renewal or an upgrade.`
        : `"${company.name}" isn't on a paid plan: quote a new subscription.`,
      code: 'purpose_not_allowed',
    });
  }
  const seats = plan.seats + input.extraSeats;
  if (seats > MAX_PLAN_SEATS) {
    throw new BadRequestException({
      message: `At most ${MAX_PLAN_SEATS} seats: ${plan.nameEn} has ${plan.seats}.`,
      code: 'too_many_seats',
    });
  }
  if (input.purpose !== 'upgrade') {
    return {
      seats,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      creditLines: [],
      creditAmount: 0,
    };
  }

  // P16: a smaller plan or fewer seats waits for the renewal.
  if (plan.position < current.position || seats < company.maxUsers) {
    throw new BadRequestException({
      message:
        'An upgrade can’t lower the plan or the seats; do that at the renewal.',
      code: 'upgrade_is_downgrade',
    });
  }
  const today = cairoDateOf(new Date());
  const period = upgradePeriod(
    today,
    cairoDateOf(company.endsAt!),
    input.months,
  );
  const samePlan = plan.id === current.id;
  if (samePlan && !period.full && seats === company.maxUsers) {
    throw new BadRequestException({
      message:
        'This upgrade changes nothing: pick a bigger plan, more seats or a longer period.',
      code: 'upgrade_changes_nothing',
    });
  }
  let creditLines: CreditLine[] = [];
  if (upgradeHasCredit(samePlan, period.full)) {
    const invoices = await manager.find(BillingDocument, {
      where: { companyId: company.id, kind: 'invoice' },
      order: { createdAt: 'ASC' },
    });
    creditLines = unusedCredit(
      invoices.map((doc) => ({
        number: doc.number,
        startsOn: doc.startsOn,
        endsOn: doc.endsOn,
        valueEgp: round2(
          (doc.subtotal - doc.discountAmount) * (doc.fxRate ?? 1),
        ),
      })),
      today,
    );
  }
  const creditEgp = round2(
    creditLines.reduce((sum, line) => sum + line.amountEgp, 0),
  );
  return {
    seats,
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    creditLines,
    creditAmount: input.fxRate ? round2(creditEgp / input.fxRate) : creditEgp,
  };
}

/** The editable part of a quotation, with its totals rebuilt (§4d). */
function fieldsOf(input: QuotationInput, plan: Plan, terms: QuotationTerms) {
  const totals = documentTotals({ ...input, creditAmount: terms.creditAmount });
  return {
    planId: plan.id,
    planNameEn: plan.nameEn,
    planNameAr: plan.nameAr,
    purpose: input.purpose,
    seats: terms.seats,
    extraSeats: input.extraSeats,
    extraSeatPrice: input.extraSeatPrice,
    extraSeatsAmount: totals.extraSeatsAmount,
    creditAmount: totals.creditAmount,
    creditLines: terms.creditLines,
    months: input.months,
    startsOn: terms.startsOn,
    endsOn: terms.endsOn,
    currency: input.currency,
    fxRate: input.fxRate,
    fxDate: input.fxRate === null ? null : cairoDateOf(new Date()),
    unitPrice: round2(input.unitPrice),
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
    purpose: q.purpose,
    seats: q.seats,
    extraSeats: q.extraSeats,
    extraSeatPrice: q.extraSeatPrice,
    extraSeatsAmount: q.extraSeatsAmount,
    creditAmount: q.creditAmount,
    creditLines: q.creditLines,
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

/**
 * The company's currency and VAT are only the next quotation's starting
 * values, set by saving a quotation (payment cycle 2.2b, Mario 2026-11-04).
 */
async function rememberPricing(
  manager: EntityManager,
  companyId: string,
  input: Pick<QuotationInput, 'currency' | 'vatRate'>,
): Promise<void> {
  await manager.update(
    Company,
    { id: companyId },
    { currency: input.currency, vatRate: input.vatRate },
  );
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
async function sellerOf(manager: EntityManager): Promise<DocumentSeller> {
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

function lastSentOf(
  row: { sent_at: Date; to: string[] } | undefined,
): BillingDocumentSummary['lastSent'] {
  return row ? { at: new Date(row.sent_at).toISOString(), to: row.to } : null;
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

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const driver = (
    error as { driverError?: { code?: string; constraint?: string } }
  )?.driverError;
  return driver?.code === '23505' && driver.constraint === constraint;
}
