import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type {
  QuoteRequestInput,
  QuoteRequestResponse,
} from '@repo/types/quote-request';
import type { DeleteLeadsResponse, LeadSummary } from '@repo/types/leads';
import { Lead } from '../../database/control-plane/entities/lead.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class LeadsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(input: QuoteRequestInput): Promise<QuoteRequestResponse> {
    // `website` (the honeypot) never reaches here: quoteRequestSchema
    // requires it be empty, so a filled-in value is already a 400 from
    // the global validation pipe before this method runs. Real users
    // never see or fill that field; anything automated that fills every
    // field blind gets rejected before a row is written.
    const lead = await this.leads.save(
      this.leads.create({
        companyName: input.companyName,
        requesterName: input.requesterName,
        phone: input.phone,
      }),
    );

    return { id: lead.id, receivedAt: lead.createdAt.toISOString() };
  }

  async list(): Promise<LeadSummary[]> {
    const leads = await this.leads.find({ order: { createdAt: 'DESC' } });
    return leads.map(toLeadSummary);
  }

  /**
   * Fired when an admin clicks the phone number to call. Always
   * overwrites with the current time rather than a "first call only"
   * guard — a lead called twice should show the most recent attempt,
   * and the UI's use of this (tint + badge) only ever needs "has this
   * been called," not a call count.
   */
  async markContacted(id: string): Promise<LeadSummary> {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found.');

    lead.contactedAt = new Date();
    await this.leads.save(lead);
    return toLeadSummary(lead);
  }

  async remove(id: string, actorId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const lead = await queryRunner.manager.findOne(Lead, { where: { id } });
      if (!lead) throw new NotFoundException('Lead not found.');

      // Written before the row disappears, same reasoning as
      // CompaniesService.remove — target_id is not a foreign key, so
      // the log survives the delete it's recording, and both live in
      // the same transaction so a failed delete never leaves an
      // orphaned "deleted" entry behind.
      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lead.deleted',
        targetType: 'lead',
        targetId: lead.id,
        metadata: {
          companyName: lead.companyName,
          requesterName: lead.requesterName,
        },
      });

      await queryRunner.manager.delete(Lead, { id });
      await queryRunner.commitTransaction();
    } catch (error) {
      if (queryRunner.isTransactionActive)
        await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Deletes exactly the rows the caller selected — driven by the
   * dashboard's row checkboxes, not a blanket "delete everything."
   * `ids` with no matching row are simply not counted; two admins
   * racing to delete the same lead isn't an error, it's just a smaller
   * `deletedCount` for whoever's request lands second.
   *
   * The empty-array check duplicates `deleteLeadsSchema`'s `min(1)` —
   * deliberately: relying on the Zod pipe alone would make an empty
   * selection either a confusing no-op 200 or a bare `IN ()` if the
   * pipe were ever bypassed, instead of a 400 that names the problem.
   */
  async removeMany(
    ids: string[],
    actorId: string,
  ): Promise<DeleteLeadsResponse> {
    if (ids.length === 0) {
      throw new BadRequestException('Select at least one lead to delete.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const leads = await queryRunner.manager.find(Lead, {
        where: { id: In(ids) },
      });

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lead.deleted_bulk',
        targetType: 'lead',
        targetId: null,
        metadata: { count: leads.length, ids: leads.map((lead) => lead.id) },
      });

      if (leads.length > 0) {
        await queryRunner.manager.delete(Lead, {
          id: In(leads.map((lead) => lead.id)),
        });
      }

      await queryRunner.commitTransaction();
      return { deletedCount: leads.length };
    } catch (error) {
      if (queryRunner.isTransactionActive)
        await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

function toLeadSummary(lead: Lead): LeadSummary {
  return {
    id: lead.id,
    companyName: lead.companyName,
    requesterName: lead.requesterName,
    phone: lead.phone,
    createdAt: lead.createdAt.toISOString(),
    contactedAt: lead.contactedAt ? lead.contactedAt.toISOString() : null,
  };
}
