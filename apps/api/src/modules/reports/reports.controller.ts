import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@repo/types/auth';
import {
  ReportLanguage,
  reportLanguageSchema,
  type CuttingSettings,
  type ReportStatus,
  type SolveStart,
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
 * The Reports section's API (docs/reports_planing.md §7). Every company
 * user may use it and change the cutting settings (D10). `lang` picks
 * the PDF's language (D13); English when omitted.
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
    @Query('lang') lang?: string,
  ): Promise<ReportStatus> {
    return this.reports.status(projectId, languageOf(lang), actor.id);
  }

  /** Starts a solve in this browser (docs/browser_solve_planing.md §7). */
  @Post('projects/:projectId/reports/bar-optimiser/solve')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  startSolve(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() dto: StartSolveDto,
    @Query('lang') lang?: string,
  ): Promise<SolveStart> {
    return this.reports.startSolve(
      projectId,
      languageOf(lang),
      actor.id,
      dto.optimiserVersion,
    );
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

  /** The finished solve: checked, stored, and this language queued to
   * print (§5, B7). */
  @Post('projects/:projectId/reports/bar-optimiser/solve/result')
  @HttpCode(202)
  solveResult(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() dto: SolveResultDto,
    @Query('lang') lang?: string,
  ): Promise<ReportStatus> {
    return this.reports.solveResult(projectId, languageOf(lang), actor.id, dto);
  }

  /** Stop (B6), or the browser giving up (B11). */
  @Post('projects/:projectId/reports/bar-optimiser/solve/stop')
  @HttpCode(200)
  stopSolve(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() dto: StopSolveDto,
    @Query('lang') lang?: string,
  ): Promise<ReportStatus> {
    return this.reports.stopSolve(projectId, languageOf(lang), actor.id, dto);
  }

  /** Prints this language from the stored solve (B4, B8). */
  @Post('projects/:projectId/reports/bar-optimiser/print')
  @HttpCode(202)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  print(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query('lang') lang?: string,
  ): Promise<ReportStatus> {
    return this.reports.print(projectId, languageOf(lang), actor.id);
  }

  @Get('projects/:projectId/reports/bar-optimiser/pdf')
  async pdf(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('lang') lang?: string,
  ): Promise<StreamableFile> {
    const { pdf, fileName } = await this.reports.pdf(
      projectId,
      languageOf(lang),
    );
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
      length: pdf.length,
    });
  }
}

function languageOf(lang: string | undefined): ReportLanguage {
  if (lang === undefined) return ReportLanguage.EN;
  const parsed = reportLanguageSchema.safeParse(lang);
  if (!parsed.success) {
    throw new BadRequestException('lang must be "en" or "ar".');
  }
  return parsed.data;
}
