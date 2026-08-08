import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../database/control-plane/entities/company.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import { Lead } from '../../database/control-plane/entities/lead.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Company, BillingRecord, Session, Lead]), TenancyModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
