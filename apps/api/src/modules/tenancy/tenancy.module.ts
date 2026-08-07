import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantConnectionService } from './tenant-connection.service';
import { TenantProvisioningService } from './tenant-provisioning.service';

// The tenant DataSource is registered globally by TenantDatabaseModule in
// AppModule, so nothing extra needs importing here for
// @InjectDataSource(TENANT_DATA_SOURCE) to resolve.
@Module({
  imports: [AuthModule],
  providers: [TenantProvisioningService, TenantConnectionService],
  exports: [TenantProvisioningService, TenantConnectionService],
})
export class TenancyModule {}
