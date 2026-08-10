import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@repo/types/auth';
import type {
  PaintBrandSummary,
  PaintingPriceSummary,
  ColorSummary,
  ColorImportResult,
  BulkDeleteResult,
  GlassCombinationSummary,
  GlassSummary,
  SystemBrandSummary,
  SystemCatalogSummary,
  SystemProfileSummary,
} from '@repo/types/lookups';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { ColorLookupsService } from './color-lookups.service';
import { GlassLookupsService } from './glass-lookups.service';
import { SystemLookupsService } from './system-lookups.service';
import { CreateColorDto } from './dto/create-color.dto';
import { UpdateColorDto } from './dto/update-color.dto';
import { CreatePaintBrandDto } from './dto/create-paint-brand.dto';
import { UpdatePaintBrandDto } from './dto/update-paint-brand.dto';
import { CreatePaintingPriceDto } from './dto/create-painting-price.dto';
import { UpdatePaintingPriceDto } from './dto/update-painting-price.dto';
import { CreateGlassDto } from './dto/create-glass.dto';
import { UpdateGlassDto } from './dto/update-glass.dto';
import { CreateGlassCombinationDto } from './dto/create-glass-combination.dto';
import { UpdateGlassCombinationDto } from './dto/update-glass-combination.dto';
import { CreateSystemBrandDto } from './dto/create-system-brand.dto';
import { UpdateSystemBrandDto } from './dto/update-system-brand.dto';
import { CreateSystemCatalogDto } from './dto/create-system-catalog.dto';
import { UpdateSystemCatalogDto } from './dto/update-system-catalog.dto';
import { CreateSystemProfileDto } from './dto/create-system-profile.dto';
import { UpdateSystemProfileDto } from './dto/update-system-profile.dto';
import { BulkIdsDto } from './dto/bulk-ids.dto';
import { BulkDuplicateColorsDto } from './dto/bulk-duplicate-colors.dto';
import { BulkDuplicateGlassDto } from './dto/bulk-duplicate-glass.dto';
import { BulkDuplicateGlassCombinationsDto } from './dto/bulk-duplicate-glass-combinations.dto';
import { BulkDuplicateSystemBrandsDto } from './dto/bulk-duplicate-system-brands.dto';
import { BulkDuplicateSystemCatalogsDto } from './dto/bulk-duplicate-system-catalogs.dto';
import { BulkDuplicateSystemProfilesDto } from './dto/bulk-duplicate-system-profiles.dto';

// Every write happens here — tenants only ever read (LookupsController).
// A DB-level FK violation on delete (ON DELETE RESTRICT throughout the
// migration) is what actually blocks "delete a value tenants may already
// reference"; each service method just translates that into a readable
// 400 (see pg-error.util.ts) rather than a raw driver error.
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/lookups')
export class AdminLookupsController {
  constructor(
    private readonly colorLookups: ColorLookupsService,
    private readonly glassLookups: GlassLookupsService,
    private readonly systemLookups: SystemLookupsService,
  ) {}

  // ---- Color ----

  @Get('colors')
  listColors(): Promise<ColorSummary[]> {
    return this.colorLookups.listColors();
  }

  @Post('colors')
  createColor(
    @Body() dto: CreateColorDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<ColorSummary> {
    return this.colorLookups.createColor(dto, actor.id);
  }

  @Patch('colors/:id')
  updateColor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateColorDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<ColorSummary> {
    return this.colorLookups.updateColor(id, dto, actor.id);
  }

  @Delete('colors/:id')
  @HttpCode(204)
  deleteColor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    return this.colorLookups.deleteColor(id, actor.id);
  }

  @Post('colors/bulk-delete')
  bulkDeleteColors(
    @Body() dto: BulkIdsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BulkDeleteResult> {
    return this.colorLookups.bulkDeleteColors(dto.ids, actor.id);
  }

  @Post('colors/bulk-duplicate')
  bulkDuplicateColors(
    @Body() dto: BulkDuplicateColorsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<ColorSummary[]> {
    return this.colorLookups.bulkDuplicateColors(dto.items, actor.id);
  }

  // 5 MB is generous for a colour list; caps the buffer this handler
  // holds in memory (memoryStorage, not disk — the file never needs to
  // outlive this one request).
  @Post('colors/import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  importColors(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<ColorImportResult> {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.colorLookups.importColors(file.buffer, actor.id);
  }

  // ---- PaintBrand ----

  @Get('paint-brands')
  listPaintBrands(): Promise<PaintBrandSummary[]> {
    return this.colorLookups.listPaintBrands();
  }

  @Post('paint-brands')
  createPaintBrand(
    @Body() dto: CreatePaintBrandDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<PaintBrandSummary> {
    return this.colorLookups.createPaintBrand(dto, actor.id);
  }

  @Patch('paint-brands/:id')
  updatePaintBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaintBrandDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<PaintBrandSummary> {
    return this.colorLookups.updatePaintBrand(id, dto, actor.id);
  }

  @Delete('paint-brands/:id')
  @HttpCode(204)
  deletePaintBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    return this.colorLookups.deletePaintBrand(id, actor.id);
  }

  // ---- PaintingPrice ----

  @Get('painting-prices')
  listPaintingPrices(): Promise<PaintingPriceSummary[]> {
    return this.colorLookups.listPaintingPrices();
  }

  @Post('painting-prices')
  createPaintingPrice(
    @Body() dto: CreatePaintingPriceDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<PaintingPriceSummary> {
    return this.colorLookups.createPaintingPrice(dto, actor.id);
  }

  @Patch('painting-prices/:id')
  updatePaintingPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaintingPriceDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<PaintingPriceSummary> {
    return this.colorLookups.updatePaintingPrice(id, dto, actor.id);
  }

  @Delete('painting-prices/:id')
  @HttpCode(204)
  deletePaintingPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    return this.colorLookups.deletePaintingPrice(id, actor.id);
  }

  // ---- Glass ----

  @Get('glass')
  listGlass(): Promise<GlassSummary[]> {
    return this.glassLookups.listGlass();
  }

  @Post('glass')
  createGlass(
    @Body() dto: CreateGlassDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<GlassSummary> {
    return this.glassLookups.createGlass(dto, actor.id);
  }

  @Patch('glass/:id')
  updateGlass(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGlassDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<GlassSummary> {
    return this.glassLookups.updateGlass(id, dto, actor.id);
  }

  @Delete('glass/:id')
  @HttpCode(204)
  deleteGlass(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    return this.glassLookups.deleteGlass(id, actor.id);
  }

  @Post('glass/bulk-delete')
  bulkDeleteGlass(
    @Body() dto: BulkIdsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BulkDeleteResult> {
    return this.glassLookups.bulkDeleteGlass(dto.ids, actor.id);
  }

  @Post('glass/bulk-duplicate')
  bulkDuplicateGlass(
    @Body() dto: BulkDuplicateGlassDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<GlassSummary[]> {
    return this.glassLookups.bulkDuplicateGlass(dto.items, actor.id);
  }

  // ---- GlassCombination ----

  @Get('glass-combinations')
  listGlassCombinations(): Promise<GlassCombinationSummary[]> {
    return this.glassLookups.listGlassCombinations();
  }

  @Post('glass-combinations')
  createGlassCombination(
    @Body() dto: CreateGlassCombinationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<GlassCombinationSummary> {
    return this.glassLookups.createGlassCombination(dto, actor.id);
  }

  @Patch('glass-combinations/:id')
  updateGlassCombination(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGlassCombinationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<GlassCombinationSummary> {
    return this.glassLookups.updateGlassCombination(id, dto, actor.id);
  }

  @Delete('glass-combinations/:id')
  @HttpCode(204)
  deleteGlassCombination(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    return this.glassLookups.deleteGlassCombination(id, actor.id);
  }

  @Post('glass-combinations/bulk-delete')
  bulkDeleteGlassCombinations(
    @Body() dto: BulkIdsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BulkDeleteResult> {
    return this.glassLookups.bulkDeleteGlassCombinations(dto.ids, actor.id);
  }

  @Post('glass-combinations/bulk-duplicate')
  bulkDuplicateGlassCombinations(
    @Body() dto: BulkDuplicateGlassCombinationsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<{ created: GlassCombinationSummary[]; failedCount: number }> {
    return this.glassLookups.bulkDuplicateGlassCombinations(
      dto.items,
      actor.id,
    );
  }

  // ---- SystemBrand ----

  @Get('system-brands')
  listSystemBrands(): Promise<SystemBrandSummary[]> {
    return this.systemLookups.listSystemBrands();
  }

  @Post('system-brands')
  createSystemBrand(
    @Body() dto: CreateSystemBrandDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemBrandSummary> {
    return this.systemLookups.createSystemBrand(dto, actor.id);
  }

  @Patch('system-brands/:id')
  updateSystemBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSystemBrandDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemBrandSummary> {
    return this.systemLookups.updateSystemBrand(id, dto, actor.id);
  }

  @Delete('system-brands/:id')
  @HttpCode(204)
  deleteSystemBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    return this.systemLookups.deleteSystemBrand(id, actor.id);
  }

  @Post('system-brands/bulk-delete')
  bulkDeleteSystemBrands(
    @Body() dto: BulkIdsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BulkDeleteResult> {
    return this.systemLookups.bulkDeleteSystemBrands(dto.ids, actor.id);
  }

  @Post('system-brands/bulk-duplicate')
  bulkDuplicateSystemBrands(
    @Body() dto: BulkDuplicateSystemBrandsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemBrandSummary[]> {
    return this.systemLookups.bulkDuplicateSystemBrands(dto.items, actor.id);
  }

  // ---- SystemCatalog ----

  @Get('system-catalogs')
  listSystemCatalogs(): Promise<SystemCatalogSummary[]> {
    return this.systemLookups.listSystemCatalogs();
  }

  @Post('system-catalogs')
  createSystemCatalog(
    @Body() dto: CreateSystemCatalogDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemCatalogSummary> {
    return this.systemLookups.createSystemCatalog(dto, actor.id);
  }

  @Patch('system-catalogs/:id')
  updateSystemCatalog(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSystemCatalogDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemCatalogSummary> {
    return this.systemLookups.updateSystemCatalog(id, dto, actor.id);
  }

  @Delete('system-catalogs/:id')
  @HttpCode(204)
  deleteSystemCatalog(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    return this.systemLookups.deleteSystemCatalog(id, actor.id);
  }

  @Post('system-catalogs/bulk-delete')
  bulkDeleteSystemCatalogs(
    @Body() dto: BulkIdsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BulkDeleteResult> {
    return this.systemLookups.bulkDeleteSystemCatalogs(dto.ids, actor.id);
  }

  @Post('system-catalogs/bulk-duplicate')
  bulkDuplicateSystemCatalogs(
    @Body() dto: BulkDuplicateSystemCatalogsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemCatalogSummary[]> {
    return this.systemLookups.bulkDuplicateSystemCatalogs(dto.items, actor.id);
  }

  // ---- SystemProfile ----

  @Get('system-profiles')
  listSystemProfiles(): Promise<SystemProfileSummary[]> {
    return this.systemLookups.listSystemProfiles();
  }

  @Post('system-profiles')
  createSystemProfile(
    @Body() dto: CreateSystemProfileDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemProfileSummary> {
    return this.systemLookups.createSystemProfile(dto, actor.id);
  }

  @Patch('system-profiles/:id')
  updateSystemProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSystemProfileDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemProfileSummary> {
    return this.systemLookups.updateSystemProfile(id, dto, actor.id);
  }

  @Delete('system-profiles/:id')
  @HttpCode(204)
  deleteSystemProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    return this.systemLookups.deleteSystemProfile(id, actor.id);
  }

  @Post('system-profiles/bulk-delete')
  bulkDeleteSystemProfiles(
    @Body() dto: BulkIdsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<BulkDeleteResult> {
    return this.systemLookups.bulkDeleteSystemProfiles(dto.ids, actor.id);
  }

  @Post('system-profiles/bulk-duplicate')
  bulkDuplicateSystemProfiles(
    @Body() dto: BulkDuplicateSystemProfilesDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<SystemProfileSummary[]> {
    return this.systemLookups.bulkDuplicateSystemProfiles(dto.items, actor.id);
  }
}
