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
  ClientDetail,
  ClientSummary,
  ClientWithProjects,
} from '@repo/types/clients';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { DeleteClientDto } from './dto/delete-client.dto';

/**
 * The first production route in the codebase to carry tenant data.
 *
 * `@TenantScoped()` at class level, so every method inherits it —
 * TenantGuard reads the metadata with `getAllAndOverride([handler,
 * class])`. A route added here later cannot forget to opt in.
 *
 * Super admins are structurally excluded: they carry no `companyId`
 * claim, so TenantGuard refuses these routes with a 403 rather than
 * guessing a schema.
 */
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  /** Drives the whole workspace tree — clients with projects nested. */
  @Get()
  listTree(): Promise<ClientWithProjects[]> {
    return this.clients.listTree();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<ClientDetail> {
    return this.clients.detail(id);
  }

  @Post()
  create(@Body() dto: CreateClientDto): Promise<ClientSummary> {
    return this.clients.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ): Promise<ClientSummary> {
    return this.clients.update(id, dto);
  }

  /** Cascades to this client's projects. Requires the name typed back. */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteClientDto,
  ): Promise<void> {
    await this.clients.remove(id, dto.confirmName);
  }
}
