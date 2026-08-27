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
  Query,
} from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { WindowDetail, WindowSummary } from '@repo/types/windows';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { WindowsService } from './windows.service';
import { CreateWindowDto } from './dto/create-window.dto';
import { UpdateWindowDto } from './dto/update-window.dto';

/**
 * `GET /windows` requires `projectId` — the canvas's card list is the
 * only caller, and it always knows which project it's looking at.
 * There is no unscoped "every window in the company" list, same as
 * ProjectsController has no unscoped "every project" list.
 */
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller('windows')
export class WindowsController {
  constructor(private readonly windows: WindowsService) {}

  @Get()
  list(
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<WindowSummary[]> {
    return this.windows.list(projectId);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<WindowDetail> {
    return this.windows.detail(id);
  }

  @Post()
  create(
    @Body() dto: CreateWindowDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<WindowDetail> {
    // The author comes from the verified JWT, never from the body.
    return this.windows.create(dto, actor.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWindowDto,
  ): Promise<WindowDetail> {
    return this.windows.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.windows.remove(id);
  }
}
