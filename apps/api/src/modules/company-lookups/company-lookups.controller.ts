import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
} from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import { LookupSlice, type BulkDeleteResult } from '@repo/types/lookups';
import type {
  CompanyColorLookups,
  CompanyColorSummary,
  CompanyGlassCombinationSummary,
  CompanyGlassLookups,
  CompanyGlassSummary,
  CompanyPaintBrandSummary,
  CompanyPaintingPriceSummary,
  CompanySystemBrandSummary,
  CompanySystemCatalogSummary,
  CompanySystemLookups,
  CompanySystemProfileSummary,
} from '@repo/types/company-lookups';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { CompanyColorLookupsService } from './company-color-lookups.service';
import { CompanyGlassLookupsService } from './company-glass-lookups.service';
import { CompanySystemLookupsService } from './company-system-lookups.service';
import { CreateColorDto } from '../lookups/dto/create-color.dto';
import { UpdateColorDto } from '../lookups/dto/update-color.dto';
import { BulkDuplicateColorsDto } from '../lookups/dto/bulk-duplicate-colors.dto';
import { CreatePaintBrandDto } from '../lookups/dto/create-paint-brand.dto';
import { UpdatePaintBrandDto } from '../lookups/dto/update-paint-brand.dto';
import { CreateCompanyPaintingPriceDto } from './dto/create-company-painting-price.dto';
import { UpdateCompanyPaintingPriceDto } from './dto/update-company-painting-price.dto';
import { CreateGlassDto } from '../lookups/dto/create-glass.dto';
import { UpdateGlassDto } from '../lookups/dto/update-glass.dto';
import { BulkDuplicateGlassDto } from '../lookups/dto/bulk-duplicate-glass.dto';
import { CreateCompanyGlassCombinationDto } from './dto/create-company-glass-combination.dto';
import { UpdateCompanyGlassCombinationDto } from './dto/update-company-glass-combination.dto';
import { BulkDuplicateCompanyGlassCombinationsDto } from './dto/bulk-duplicate-company-glass-combinations.dto';
import { CreateSystemBrandDto } from '../lookups/dto/create-system-brand.dto';
import { UpdateSystemBrandDto } from '../lookups/dto/update-system-brand.dto';
import { BulkDuplicateSystemBrandsDto } from '../lookups/dto/bulk-duplicate-system-brands.dto';
import { CreateCompanySystemCatalogDto } from './dto/create-company-system-catalog.dto';
import { UpdateCompanySystemCatalogDto } from './dto/update-company-system-catalog.dto';
import { BulkDuplicateCompanySystemCatalogsDto } from './dto/bulk-duplicate-company-system-catalogs.dto';
import { CreateCompanySystemProfileDto } from './dto/create-company-system-profile.dto';
import { UpdateCompanySystemProfileDto } from './dto/update-company-system-profile.dto';
import { BulkDuplicateCompanySystemProfilesDto } from './dto/bulk-duplicate-company-system-profiles.dto';
import { BulkIdsDto } from '../lookups/dto/bulk-ids.dto';

interface SliceResponse<T> {
  data: T;
}

// A company's own rows in the same 8 lookup categories as the platform
// catalogue (GET /lookups/:slice) — see
// docs/company_lookups_planing.md. Routes mirror admin-lookups.controller.ts
// one-for-one minus /import (not built this phase) and minus every
// per-entity GET (the frontend only ever reads the slice-level union,
// Step 12's useMergedLookupSlice).
//
// Both company roles write here, not just COMPANY_ADMIN — matches the
// precedent set for project deletion (docs/projects_planing.md, "at a
// five-seat ceiling everyone in a company is a trusted colleague").
// No `versions` field on the slice response, unlike the platform's —
// company lookups have no lookup_meta/version machinery to report.
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller('company/lookups')
export class CompanyLookupsController {
  constructor(
    private readonly colorLookups: CompanyColorLookupsService,
    private readonly glassLookups: CompanyGlassLookupsService,
    private readonly systemLookups: CompanySystemLookupsService,
  ) {}

  @Get(':slice')
  slice(
    @Param('slice') slice: string,
  ): Promise<
    SliceResponse<
      CompanyColorLookups | CompanyGlassLookups | CompanySystemLookups
    >
  > {
    switch (slice) {
      case LookupSlice.GLASS:
        return this.glassLookups.assembleSlice().then((data) => ({ data }));
      case LookupSlice.COLORS:
        return this.colorLookups.assembleSlice().then((data) => ({ data }));
      case LookupSlice.SYSTEMS:
        return this.systemLookups.assembleSlice().then((data) => ({ data }));
      default:
        throw new NotFoundException(`Unknown lookup slice "${slice}".`);
    }
  }

  // ---- Color ----

  @Post('colors')
  createColor(@Body() dto: CreateColorDto): Promise<CompanyColorSummary> {
    return this.colorLookups.createColor(dto);
  }

  @Patch('colors/:id')
  updateColor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateColorDto,
  ): Promise<CompanyColorSummary> {
    return this.colorLookups.updateColor(id, dto);
  }

  @Delete('colors/:id')
  @HttpCode(204)
  deleteColor(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.colorLookups.deleteColor(id);
  }

  @Post('colors/bulk-delete')
  bulkDeleteColors(@Body() dto: BulkIdsDto): Promise<BulkDeleteResult> {
    return this.colorLookups.bulkDeleteColors(dto.ids);
  }

  @Post('colors/bulk-duplicate')
  bulkDuplicateColors(
    @Body() dto: BulkDuplicateColorsDto,
  ): Promise<CompanyColorSummary[]> {
    return this.colorLookups.bulkDuplicateColors(dto.items);
  }

  // ---- PaintBrand ----

  @Post('paint-brands')
  createPaintBrand(
    @Body() dto: CreatePaintBrandDto,
  ): Promise<CompanyPaintBrandSummary> {
    return this.colorLookups.createPaintBrand(dto);
  }

  @Patch('paint-brands/:id')
  updatePaintBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaintBrandDto,
  ): Promise<CompanyPaintBrandSummary> {
    return this.colorLookups.updatePaintBrand(id, dto);
  }

  @Delete('paint-brands/:id')
  @HttpCode(204)
  deletePaintBrand(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.colorLookups.deletePaintBrand(id);
  }

  // ---- PaintingPrice ----

  @Post('painting-prices')
  createPaintingPrice(
    @Body() dto: CreateCompanyPaintingPriceDto,
  ): Promise<CompanyPaintingPriceSummary> {
    return this.colorLookups.createPaintingPrice(dto);
  }

  @Patch('painting-prices/:id')
  updatePaintingPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyPaintingPriceDto,
  ): Promise<CompanyPaintingPriceSummary> {
    return this.colorLookups.updatePaintingPrice(id, dto);
  }

  @Delete('painting-prices/:id')
  @HttpCode(204)
  deletePaintingPrice(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.colorLookups.deletePaintingPrice(id);
  }

  // ---- Glass ----

  @Post('glass')
  createGlass(@Body() dto: CreateGlassDto): Promise<CompanyGlassSummary> {
    return this.glassLookups.createGlass(dto);
  }

  @Patch('glass/:id')
  updateGlass(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGlassDto,
  ): Promise<CompanyGlassSummary> {
    return this.glassLookups.updateGlass(id, dto);
  }

  @Delete('glass/:id')
  @HttpCode(204)
  deleteGlass(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.glassLookups.deleteGlass(id);
  }

  @Post('glass/bulk-delete')
  bulkDeleteGlass(@Body() dto: BulkIdsDto): Promise<BulkDeleteResult> {
    return this.glassLookups.bulkDeleteGlass(dto.ids);
  }

  @Post('glass/bulk-duplicate')
  bulkDuplicateGlass(
    @Body() dto: BulkDuplicateGlassDto,
  ): Promise<CompanyGlassSummary[]> {
    return this.glassLookups.bulkDuplicateGlass(dto.items);
  }

  // ---- GlassCombination ----

  @Post('glass-combinations')
  createGlassCombination(
    @Body() dto: CreateCompanyGlassCombinationDto,
  ): Promise<CompanyGlassCombinationSummary> {
    return this.glassLookups.createGlassCombination(dto);
  }

  @Patch('glass-combinations/:id')
  updateGlassCombination(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyGlassCombinationDto,
  ): Promise<CompanyGlassCombinationSummary> {
    return this.glassLookups.updateGlassCombination(id, dto);
  }

  @Delete('glass-combinations/:id')
  @HttpCode(204)
  deleteGlassCombination(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.glassLookups.deleteGlassCombination(id);
  }

  @Post('glass-combinations/bulk-delete')
  bulkDeleteGlassCombinations(
    @Body() dto: BulkIdsDto,
  ): Promise<BulkDeleteResult> {
    return this.glassLookups.bulkDeleteGlassCombinations(dto.ids);
  }

  @Post('glass-combinations/bulk-duplicate')
  bulkDuplicateGlassCombinations(
    @Body() dto: BulkDuplicateCompanyGlassCombinationsDto,
  ): Promise<{
    created: CompanyGlassCombinationSummary[];
    failedCount: number;
  }> {
    return this.glassLookups.bulkDuplicateGlassCombinations(dto.items);
  }

  // ---- SystemBrand ----

  @Post('system-brands')
  createSystemBrand(
    @Body() dto: CreateSystemBrandDto,
  ): Promise<CompanySystemBrandSummary> {
    return this.systemLookups.createSystemBrand(dto);
  }

  @Patch('system-brands/:id')
  updateSystemBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSystemBrandDto,
  ): Promise<CompanySystemBrandSummary> {
    return this.systemLookups.updateSystemBrand(id, dto);
  }

  @Delete('system-brands/:id')
  @HttpCode(204)
  deleteSystemBrand(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.systemLookups.deleteSystemBrand(id);
  }

  @Post('system-brands/bulk-delete')
  bulkDeleteSystemBrands(@Body() dto: BulkIdsDto): Promise<BulkDeleteResult> {
    return this.systemLookups.bulkDeleteSystemBrands(dto.ids);
  }

  @Post('system-brands/bulk-duplicate')
  bulkDuplicateSystemBrands(
    @Body() dto: BulkDuplicateSystemBrandsDto,
  ): Promise<CompanySystemBrandSummary[]> {
    return this.systemLookups.bulkDuplicateSystemBrands(dto.items);
  }

  // ---- SystemCatalog ----

  @Post('system-catalogs')
  createSystemCatalog(
    @Body() dto: CreateCompanySystemCatalogDto,
  ): Promise<CompanySystemCatalogSummary> {
    return this.systemLookups.createSystemCatalog(dto);
  }

  @Patch('system-catalogs/:id')
  updateSystemCatalog(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanySystemCatalogDto,
  ): Promise<CompanySystemCatalogSummary> {
    return this.systemLookups.updateSystemCatalog(id, dto);
  }

  @Delete('system-catalogs/:id')
  @HttpCode(204)
  deleteSystemCatalog(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.systemLookups.deleteSystemCatalog(id);
  }

  @Post('system-catalogs/bulk-delete')
  bulkDeleteSystemCatalogs(@Body() dto: BulkIdsDto): Promise<BulkDeleteResult> {
    return this.systemLookups.bulkDeleteSystemCatalogs(dto.ids);
  }

  @Post('system-catalogs/bulk-duplicate')
  bulkDuplicateSystemCatalogs(
    @Body() dto: BulkDuplicateCompanySystemCatalogsDto,
  ): Promise<CompanySystemCatalogSummary[]> {
    return this.systemLookups.bulkDuplicateSystemCatalogs(dto.items);
  }

  // ---- SystemProfile ----

  @Post('system-profiles')
  createSystemProfile(
    @Body() dto: CreateCompanySystemProfileDto,
  ): Promise<CompanySystemProfileSummary> {
    return this.systemLookups.createSystemProfile(dto);
  }

  @Patch('system-profiles/:id')
  updateSystemProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanySystemProfileDto,
  ): Promise<CompanySystemProfileSummary> {
    return this.systemLookups.updateSystemProfile(id, dto);
  }

  @Delete('system-profiles/:id')
  @HttpCode(204)
  deleteSystemProfile(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.systemLookups.deleteSystemProfile(id);
  }

  @Post('system-profiles/bulk-delete')
  bulkDeleteSystemProfiles(@Body() dto: BulkIdsDto): Promise<BulkDeleteResult> {
    return this.systemLookups.bulkDeleteSystemProfiles(dto.ids);
  }

  @Post('system-profiles/bulk-duplicate')
  bulkDuplicateSystemProfiles(
    @Body() dto: BulkDuplicateCompanySystemProfilesDto,
  ): Promise<CompanySystemProfileSummary[]> {
    return this.systemLookups.bulkDuplicateSystemProfiles(dto.items);
  }
}
