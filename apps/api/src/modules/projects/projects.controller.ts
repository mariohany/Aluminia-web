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
import type { ProjectDetail } from '@repo/types/projects';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { DeleteProjectDto } from './dto/delete-project.dto';

/**
 * No `GET /projects` — the workspace tree is served by `GET /clients`
 * with projects nested, so a flat list has no caller.
 *
 * No archive route either: a project has no lifecycle status. It exists
 * or it is deleted. See docs/projects_planing.md's decisions table.
 */
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<ProjectDetail> {
    return this.projects.detail(id);
  }

  @Post()
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<ProjectDetail> {
    // The author comes from the verified JWT, never from the body —
    // otherwise any caller could attribute a project to a colleague.
    return this.projects.create(dto, actor.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectDetail> {
    return this.projects.update(id, dto);
  }

  /** Requires the name typed back — see ProjectsService.remove(). */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteProjectDto,
  ): Promise<void> {
    await this.projects.remove(id, dto.confirmName);
  }
}
