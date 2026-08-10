import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LookupMeta } from '../../database/control-plane/entities/lookup-meta.entity';
import { Color } from '../../database/control-plane/entities/color.entity';
import { PaintBrand } from '../../database/control-plane/entities/paint-brand.entity';
import { PaintingPrice } from '../../database/control-plane/entities/painting-price.entity';
import { Glass } from '../../database/control-plane/entities/glass.entity';
import { GlassCombination } from '../../database/control-plane/entities/glass-combination.entity';
import { GlassCombinationItem } from '../../database/control-plane/entities/glass-combination-item.entity';
import { SystemBrand } from '../../database/control-plane/entities/system-brand.entity';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { LookupsController } from './lookups.controller';
import { AdminLookupsController } from './admin-lookups.controller';
import { LookupCacheService } from './lookup-cache.service';
import { ColorLookupsService } from './color-lookups.service';
import { GlassLookupsService } from './glass-lookups.service';
import { SystemLookupsService } from './system-lookups.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LookupMeta,
      Color,
      PaintBrand,
      PaintingPrice,
      Glass,
      GlassCombination,
      GlassCombinationItem,
      SystemBrand,
      SystemCatalog,
      SystemProfile,
    ]),
    AuditLogModule,
    // RedisModule is @Global() — REDIS_CLIENT needs no explicit import.
  ],
  controllers: [LookupsController, AdminLookupsController],
  providers: [
    LookupCacheService,
    ColorLookupsService,
    GlassLookupsService,
    SystemLookupsService,
  ],
})
export class LookupsModule {}
