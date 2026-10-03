import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../database/control-plane/entities/company.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import { ProjectCountsModule } from '../project-counts/project-counts.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Company, Session]), ProjectCountsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
