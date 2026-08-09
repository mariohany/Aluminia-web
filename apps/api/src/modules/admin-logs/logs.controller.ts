import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type {
  ActivityLogEntry,
  AuditLogEntry,
  PaginatedResult,
} from '@repo/types/logs';
import { Roles } from '../../common/decorators/roles.decorator';
import { LogsService } from './logs.service';
import { LogsQueryDto } from './dto/logs-query.dto';

// Read side of the admin logs: the standalone Logs page's two tabs.
// Writes go through AuditLogService (modules/audit-log) directly against
// the caller's own transaction; this controller only ever reads.
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get('activity')
  activity(
    @Query() { page, pageSize, from, to }: LogsQueryDto,
  ): Promise<PaginatedResult<ActivityLogEntry>> {
    return this.logs.activityLog(page, pageSize, { from, to });
  }

  @Get('audit')
  audit(
    @Query() { page, pageSize, from, to }: LogsQueryDto,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    return this.logs.auditLog(page, pageSize, { from, to });
  }
}
