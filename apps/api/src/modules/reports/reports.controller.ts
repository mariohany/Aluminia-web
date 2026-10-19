import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@repo/types/auth';
import type {
  BarOptimiserReportResponse,
  CuttingSettings,
  ReportStatus,
  SolveStart,
} from '@repo/types/reports';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { CuttingSettingsDto } from './dto/cutting-settings.dto';
import {
  SolveProgressDto,
  SolveResultDto,
  StartSolveDto,
  StopSolveDto,
} from './dto/solve.dto';
import { ReportsService } from './reports.service';

/**
 * The Reports section's API (docs/reports_planing.md §7,
 * docs/browser_pdf_planing.md §7). Every company user may use it and
 * change the cutting settings (D10). The browser solves and draws the PDF
 * (in either language); the server only checks and stores.
 */
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/cutting-settings')
  getSettings(): Promise<CuttingSettings> {
    return this.reports.getSettings();
  }

  @Put('reports/cutting-settings')
  saveSettings(@Body() dto: CuttingSettingsDto): Promise<CuttingSettings> {
    return this.reports.saveSettings(dto);
  }

  @Get('projects/:projectId/reports/bar-optimiser')
  status(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<ReportStatus> {
    return this.reports.status(projectId, actor.id);
  }

  /** The snapshot to draw the PDF from + today's company details. */
  @Get('projects/:projectId/reports/bar-optimiser/report')
  report(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<BarOptimiserReportResponse> {
    return this.reports.report(projectId);
  }

  /** Only the project or client was renamed: refresh the names (P8). */
  @Post('projects/:projectId/reports/bar-optimiser/refresh')
  @HttpCode(200)
  refresh(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<ReportStatus> {
    return this.reports.refresh(projectId, actor.id);
  }

  /** Starts a solve in this browser (docs/browser_solve_planing.md §7). */
  @Post('projects/:projectId/reports/bar-optimiser/solve')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  startSolve(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() dto: StartSolveDto,
  ): Promise<SolveStart> {
    return this.reports.startSolve(projectId, actor.id, dto.optimiserVersion);
  }

  /** The solving browser's progress and heartbeat (B5). */
  @Put('projects/:projectId/reports/bar-optimiser/solve/progress')
  @HttpCode(204)
  progress(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: SolveProgressDto,
  ): Promise<void> {
    return this.reports.progress(projectId, dto);
  }

  /** The finished solve: checked and saved with the report snapshot. */
  @Post('projects/:projectId/reports/bar-optimiser/solve/result')
  @HttpCode(200)
  solveResult(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() dto: SolveResultDto,
  ): Promise<ReportStatus> {
    return this.reports.solveResult(projectId, actor.id, dto);
  }

  /** Stop (B6), or the browser giving up (B11). */
  @Post('projects/:projectId/reports/bar-optimiser/solve/stop')
  @HttpCode(200)
  stopSolve(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() dto: StopSolveDto,
  ): Promise<ReportStatus> {
    return this.reports.stopSolve(projectId, actor.id, dto);
  }
}
