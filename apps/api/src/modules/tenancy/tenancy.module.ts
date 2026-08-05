import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Module({
  imports: [AuthModule],
  providers: [TenantProvisioningService],
  exports: [TenantProvisioningService],
})
export class TenancyModule {}
