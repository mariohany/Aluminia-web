import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * The Reports section — the bar optimiser today
 * (docs/reports_planing.md, docs/browser_solve_planing.md,
 * docs/browser_pdf_planing.md). The browser solves and draws the PDF; the
 * server checks and stores. `forFeature` is for the control plane only
 * (platform profiles + catalogues, and users for "being made by …");
 * tenant tables go through TenantContextService, as everywhere else.
 */
@Module({
  imports: [
    TenancyModule,
    TypeOrmModule.forFeature([SystemProfile, SystemCatalog, User]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
