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
  Put,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { UserRole } from '@repo/types/auth';
import {
  createProjectStatusSchema,
  reorderProjectStatusesSchema,
  updateProjectSettingsSchema,
  updateProjectStatusSchema,
  type ProjectSettings,
  type ProjectStatus,
} from '@repo/types/project-settings';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { ProjectSettingsService } from './project-settings.service';
import { ProjectStatusesService } from './project-statuses.service';

class UpdateProjectSettingsDto extends createZodDto(
  updateProjectSettingsSchema,
) {}
class CreateProjectStatusDto extends createZodDto(createProjectStatusSchema) {}
class UpdateProjectStatusDto extends createZodDto(updateProjectStatusSchema) {}
class ReorderProjectStatusesDto extends createZodDto(
  reorderProjectStatusesSchema,
) {}

/**
 * Config › Project settings (docs/project_settings_planing.md §4). Every
 * company user reads (the new-project dialog reads the defaults, the
 * project panel the statuses); only the company admin writes (S9). The
 * super admin never gets here: `@TenantScoped()` refuses them.
 */
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller('project-settings')
export class ProjectSettingsController {
  constructor(private readonly settings: ProjectSettingsService) {}

  @Get()
  get(): Promise<ProjectSettings> {
    return this.settings.get();
  }

  @Patch()
  @Roles(UserRole.COMPANY_ADMIN)
  update(@Body() dto: UpdateProjectSettingsDto): Promise<ProjectSettings> {
    return this.settings.update(dto);
  }
}

@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller('project-statuses')
export class ProjectStatusesController {
  constructor(private readonly statuses: ProjectStatusesService) {}

  @Get()
  list(): Promise<ProjectStatus[]> {
    return this.statuses.list();
  }

  @Post()
  @Roles(UserRole.COMPANY_ADMIN)
  create(@Body() dto: CreateProjectStatusDto): Promise<ProjectStatus> {
    return this.statuses.create(dto);
  }

  // Declared before `:id` so "order" is never read as an id.
  @Put('order')
  @Roles(UserRole.COMPANY_ADMIN)
  reorder(@Body() dto: ReorderProjectStatusesDto): Promise<ProjectStatus[]> {
    return this.statuses.reorder(dto.ids);
  }

  @Patch(':id')
  @Roles(UserRole.COMPANY_ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectStatusDto,
  ): Promise<ProjectStatus> {
    return this.statuses.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.COMPANY_ADMIN)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.statuses.remove(id);
  }
}
