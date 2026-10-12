import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { QuoteRequestResponse } from '@repo/types/quote-request';
import { Public } from '../../common/decorators/public.decorator';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';

/**
 * The one route an anonymous landing-page visitor can call. `@Public()`
 * because there's no login yet to require — the fourth public route
 * alongside `/health` and the three `/auth/*` ones.
 *
 * Rate-limited much tighter than the global default (RateLimitModule):
 * 5 submissions per IP per 10 minutes.
 */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('quote-requests')
  create(@Body() dto: CreateLeadDto): Promise<QuoteRequestResponse> {
    return this.leads.create(dto);
  }
}
