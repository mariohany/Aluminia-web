import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QuoteRequestInput, QuoteRequestResponse } from '@repo/types/quote-request';
import { Lead } from '../../database/control-plane/entities/lead.entity';

@Injectable()
export class LeadsService {
  constructor(@InjectRepository(Lead) private readonly leads: Repository<Lead>) {}

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
}
