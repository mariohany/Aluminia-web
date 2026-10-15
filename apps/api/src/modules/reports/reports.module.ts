import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { BarOptimiserRunner } from './bar-optimiser/runner';
import { PdfRenderer } from './pdf/pdf-renderer.service';
import { ReportJobService } from './report-job.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * The Reports section — the bar optimiser today
 * (docs/reports_planing.md). `forFeature` is for the PLATFORM catalogue
 * only (profiles + catalogues, control plane); tenant tables go through
 * TenantContextService / TenantConnectionService, as everywhere else.
 */
@Module({
  imports: [
    TenancyModule,
    TypeOrmModule.forFeature([SystemProfile, SystemCatalog]),
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportJobService,
    BarOptimiserRunner,
    PdfRenderer,
  ],
})
export class ReportsModule {}
