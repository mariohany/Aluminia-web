import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../database/control-plane/entities/company.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ProjectCountsService } from './project-counts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Company]), TenancyModule],
  providers: [ProjectCountsService],
  exports: [ProjectCountsService],
})
export class ProjectCountsModule {}
