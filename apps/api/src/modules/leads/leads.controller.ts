import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { QuoteRequestResponse } from '@repo/types/quote-request';
import { Public } from '../../common/decorators/public.decorator';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';

/**
 * The one route an anonymous landing-page visitor can call. `@Public()`
 * because there's no login yet to require — the fourth public route
 * alongside `/health` and the three `/auth/*` ones.
 *
 * Rate-limited, scoped to just this handler rather than registered
 * globally: nothing else in the app is reachable without a token, so
 * nothing else needs protecting from an anonymous flood.
 */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('quote-requests')
  create(@Body() dto: CreateLeadDto): Promise<QuoteRequestResponse> {
    return this.leads.create(dto);
  }
}
