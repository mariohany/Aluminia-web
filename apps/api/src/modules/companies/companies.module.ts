import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../database/control-plane/entities/company.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, User, BillingRecord]),
    AuditLogModule,
    TenancyModule,
  ],
  controllers: [CompaniesController],
  providers: [CompaniesService],
})
export class CompaniesModule {}
