import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Color } from '../../database/control-plane/entities/color.entity';
import { PaintBrand } from '../../database/control-plane/entities/paint-brand.entity';
import { PaintingPrice } from '../../database/control-plane/entities/painting-price.entity';
import { Glass } from '../../database/control-plane/entities/glass.entity';
import { GlassCombination } from '../../database/control-plane/entities/glass-combination.entity';
import { SystemBrand } from '../../database/control-plane/entities/system-brand.entity';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CompanyLookupsController } from './company-lookups.controller';
import { CompanyColorLookupsService } from './company-color-lookups.service';
import { CompanyGlassLookupsService } from './company-glass-lookups.service';
import { CompanySystemLookupsService } from './company-system-lookups.service';

/**
 * Company-owned rows in the same 8 lookup categories as the platform
 * catalogue (Phase 2, docs/company_lookups_planing.md) — deliberately
 * its own module rather than folded into LookupsModule, which is
 * platform-only end to end. Named after the singular `company` module
 * convention (a company managing its own things), not `companies`.
 *
 * `TypeOrmModule.forFeature([...])` here is for the PLATFORM
 * control-plane entities only — read-only collision checks and
 * cross-scope display-name resolution against `this.dataSource`'s
 * default connection. The nine company_* TENANT entities are never
 * bound to a repository here; they're reached through
 * `TenantContextService`'s per-request `EntityManager`, same as every
 * other tenant table (see ClientsModule's comment).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Color,
      PaintBrand,
      PaintingPrice,
      Glass,
      GlassCombination,
      SystemBrand,
      SystemCatalog,
      SystemProfile,
    ]),
    TenancyModule,
  ],
  controllers: [CompanyLookupsController],
  providers: [
    CompanyColorLookupsService,
    CompanyGlassLookupsService,
    CompanySystemLookupsService,
  ],
})
export class CompanyLookupsModule {}
