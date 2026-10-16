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
} from '@repo/types/reports';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { CuttingSettingsDto } from './dto/cutting-settings.dto';
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
    @Query('lang') lang?: string,
  ): Promise<ReportStatus> {
    return this.reports.status(projectId, languageOf(lang));
  }

  @Post('projects/:projectId/reports/bar-optimiser/generate')
  @HttpCode(202)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  generate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query('lang') lang?: string,
  ): Promise<ReportStatus> {
    return this.reports.generate(projectId, languageOf(lang), actor.id);
  }

  /** Only a job still waiting for a slot (docs/report_queue_planing.md C8). */
  @Post('projects/:projectId/reports/bar-optimiser/cancel')
  @HttpCode(200)
  cancel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('lang') lang?: string,
  ): Promise<ReportStatus> {
    return this.reports.cancel(projectId, languageOf(lang));
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
