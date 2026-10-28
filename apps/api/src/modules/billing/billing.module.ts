import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { FilesModule } from '../files/files.module';
import { AdminBillingProfileController } from './admin-billing-profile.controller';
import { BillingProfileService } from './billing-profile.service';

@Module({
  imports: [AuditLogModule, FilesModule],
  controllers: [AdminBillingProfileController],
  providers: [BillingProfileService],
  exports: [BillingProfileService],
})
export class BillingModule {}
