import { Module } from '@nestjs/common';
import { TenancyModule } from '../../src/modules/tenancy/tenancy.module';
import { TenantWhoamiController } from './tenant-whoami.controller';

/**
 * TEST-ONLY. Imports the real TenancyModule (for TenantContextService,
 * which it exports) so the throwaway controller gets the exact same DI
 * wiring, guards, and providers a real tenant-scoped route would — the
 * only thing test-only about this is that it's never added to
 * AppModule. Nest treats an imported module as a singleton per
 * application by class reference, so importing TenancyModule here again
 * (AppModule already does, via TenancyModule → APP_GUARD) does not
 * double-register TenantGuard or create a second instance of anything.
 */
@Module({
  imports: [TenancyModule],
  controllers: [TenantWhoamiController],
})
export class TenantWhoamiTestModule {}
