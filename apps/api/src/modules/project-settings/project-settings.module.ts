import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/control-plane/entities/user.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import {
  ProjectSettingsController,
  ProjectStatusesController,
} from './project-settings.controller';
import { ProjectSettingsService } from './project-settings.service';
import { ProjectStatusesService } from './project-statuses.service';

// `User` is the control-plane repository (responsible users); the tenant
// tables go through TenantContextService, never forFeature.
@Module({
  imports: [TypeOrmModule.forFeature([User]), TenancyModule],
  controllers: [ProjectSettingsController, ProjectStatusesController],
  providers: [ProjectSettingsService, ProjectStatusesService],
})
export class ProjectSettingsModule {}
