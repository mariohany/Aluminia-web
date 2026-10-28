import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from '../../database/control-plane/entities/plan.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AdminPlansController } from './admin-plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [TypeOrmModule.forFeature([Plan]), AuditLogModule],
  controllers: [AdminPlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
