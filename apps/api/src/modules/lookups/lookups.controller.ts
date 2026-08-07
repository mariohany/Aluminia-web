import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { LookupSlice } from '@repo/types/lookups';
import type {
  ColorLookups,
  GlassLookups,
  LookupVersion,
  SystemLookups,
} from '@repo/types/lookups';
import { LookupCacheService } from './lookup-cache.service';
import { ColorLookupsService } from './color-lookups.service';
import { GlassLookupsService } from './glass-lookups.service';
import { SystemLookupsService } from './system-lookups.service';

interface SliceResponse<T> {
  versions: Partial<LookupVersion>;
  data: T;
}

// Any authenticated user — tenants read this data, never write it (no
// @Roles here, same as GET /me). No tenant-schema involvement either:
// lookups are global, shared control-plane data (Section 4's "global
// only" decision), so this is a plain repository read, not routed
// through TenantConnectionService.
@Controller('lookups')
export class LookupsController {
  constructor(
    private readonly cache: LookupCacheService,
    private readonly colorLookups: ColorLookupsService,
    private readonly glassLookups: GlassLookupsService,
    private readonly systemLookups: SystemLookupsService,
  ) {}

  @Get('version')
  version(): Promise<LookupVersion> {
    return this.cache.getVersions();
  }

  @Get(':slice')
  slice(
    @Param('slice') slice: string,
  ): Promise<SliceResponse<ColorLookups | GlassLookups | SystemLookups>> {
    switch (slice) {
      case LookupSlice.GLASS:
        return this.cache.getSlice(slice, () =>
          this.glassLookups.assembleSlice(),
        );
      case LookupSlice.COLORS:
        return this.cache.getSlice(slice, () =>
          this.colorLookups.assembleSlice(),
        );
      case LookupSlice.SYSTEMS:
        return this.cache.getSlice(slice, () =>
          this.systemLookups.assembleSlice(),
        );
      default:
        throw new NotFoundException(`Unknown lookup slice "${slice}".`);
    }
  }
}
