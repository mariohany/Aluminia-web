import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/**
 * No `TypeOrmModule.forFeature([Client])` here, unlike the control-plane
 * modules. A tenant repository would be bound to one schema at
 * construction time, which is precisely what must not happen — tenant
 * entities are reached through the request's `EntityManager`, handed
 * out by `TenantContextService`.
 */
@Module({
  imports: [TenancyModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
