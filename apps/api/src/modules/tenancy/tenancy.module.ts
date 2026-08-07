import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Company } from '../../database/control-plane/entities/company.entity';
import { TenantGuard } from './guards/tenant.guard';
import { TenantConnectionService } from './tenant-connection.service';
import { TenantContextService } from './tenant-context.service';
import { TenantProvisioningService } from './tenant-provisioning.service';

// The tenant DataSource is registered globally by TenantDatabaseModule in
// AppModule, so nothing extra needs importing here for
// @InjectDataSource(TENANT_DATA_SOURCE) to resolve. Company is imported
// directly (rather than re-exported from AuthModule, which doesn't
// export it) so TenantGuard can look companies up.
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Company])],
  providers: [
    TenantProvisioningService,
    TenantConnectionService,
    TenantContextService,
    // Registered here, not AuthModule: NestJS applies global guards in
    // provider-registration order across modules, and AppModule imports
    // AuthModule before TenancyModule, so this runs after JwtAuthGuard
    // and RolesGuard — request.user is already populated.
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
  exports: [
    TenantProvisioningService,
    TenantConnectionService,
    TenantContextService,
  ],
})
export class TenancyModule {}
