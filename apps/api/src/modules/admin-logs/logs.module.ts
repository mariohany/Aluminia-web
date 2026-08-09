import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLog } from '../../database/control-plane/entities/admin-audit-log.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAuditLog, BillingRecord])],
  controllers: [LogsController],
  providers: [LogsService],
})
export class LogsModule {}
