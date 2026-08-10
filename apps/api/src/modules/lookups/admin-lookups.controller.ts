import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type {
  PaintBrandSummary,
  PaintingPriceSummary,
  ColorSummary,
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
}
