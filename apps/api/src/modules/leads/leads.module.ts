import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../../database/control-plane/entities/lead.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { LeadsController } from './leads.controller';
import { AdminLeadsController } from './admin-leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), AuditLogModule],
  controllers: [LeadsController, AdminLeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
