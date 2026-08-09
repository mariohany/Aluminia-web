import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { DeleteLeadsResponse, LeadSummary } from '@repo/types/leads';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { LeadsService } from './leads.service';
import { DeleteLeadsDto } from './dto/delete-leads.dto';

/**
 * The super admin's side of leads: the list the dashboard's leads
 * section reads from, marking one as called, and deleting.
 *
 * Separate controller from the public `LeadsController` — same split as
 * lookups' public vs `admin/lookups` controllers — so the one
 * unauthenticated, rate-limited route stays visually and behaviorally
 * apart from everything that needs a super-admin token.
 */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/leads')
export class AdminLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(): Promise<LeadSummary[]> {
    return this.leads.list();
  }

  @Post(':id/contacted')
  @HttpCode(200)
  markContacted(@Param('id', ParseUUIDPipe) id: string): Promise<LeadSummary> {
    return this.leads.markContacted(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.leads.remove(id, actor.id);
  }

  @Delete()
  removeMany(
    @Body() dto: DeleteLeadsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<DeleteLeadsResponse> {
    return this.leads.removeMany(dto.ids, actor.id);
  }
}
