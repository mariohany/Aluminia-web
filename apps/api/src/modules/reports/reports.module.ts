import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { availableParallelism } from 'node:os';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../../config/env.schema';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FilesModule } from '../files/files.module';
import { PdfRenderer } from './pdf/pdf-renderer.service';
import { ReportJobQueue } from './report-job-queue';
import { ReportJobService } from './report-job.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * The Reports section — the bar optimiser today
 * (docs/reports_planing.md, docs/browser_solve_planing.md). `forFeature`
 * is for the control plane only (platform profiles + catalogues, and
 * users for "being made by …"); tenant tables go through
 * TenantContextService / TenantConnectionService, as everywhere else.
 */
@Module({
  imports: [
    TenancyModule,
    FilesModule,
    TypeOrmModule.forFeature([SystemProfile, SystemCatalog, User]),
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportJobService,
    PdfRenderer,
    {
      // docs/report_queue_planing.md C1: REPORT_MAX_CONCURRENT, else one
      // job per CPU but one, at least one.
      provide: ReportJobQueue,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const slots =
          config.get('REPORT_MAX_CONCURRENT', { infer: true }) ??
          Math.max(1, availableParallelism() - 1);
        new Logger('ReportJobQueue').log(
          `Report jobs: ${slots} at once on this instance`,
        );
        return new ReportJobQueue(slots);
      },
    },
  ],
})
export class ReportsModule {}
