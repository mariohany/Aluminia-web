import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FxRate } from '../../database/control-plane/entities/fx-rate.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { FilesModule } from '../files/files.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingProfileController } from './admin-billing-profile.controller';
import { BillingDocumentsService } from './billing-documents.service';
import { BillingProfileService } from './billing-profile.service';
import { CompanyAlertsController } from './company-alerts.controller';
import { CompanyAlertsService } from './company-alerts.service';
import { FX_SOURCE, FxService, openErApiSource } from './fx.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FxRate]),
    AuditLogModule,
    FilesModule,
    SubscriptionsModule,
    TenancyModule,
  ],
  controllers: [
    AdminBillingProfileController,
    AdminBillingController,
    CompanyAlertsController,
  ],
  providers: [
    BillingProfileService,
    BillingDocumentsService,
    FxService,
    CompanyAlertsService,
    { provide: FX_SOURCE, useValue: openErApiSource },
  ],
  exports: [BillingProfileService, BillingDocumentsService],
})
export class BillingModule {}
