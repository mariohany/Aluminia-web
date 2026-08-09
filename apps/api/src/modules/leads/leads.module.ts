import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { Lead } from '../../database/control-plane/entities/lead.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { LeadsController } from './leads.controller';
import { AdminLeadsController } from './admin-leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead]),
    AuditLogModule,
    // Scoped here rather than in AppModule: the public quote-request
    // route is the only one in the whole API an unauthenticated caller
    // can flood, so it's the only place a rate limiter needs to exist.
    // admin/leads needs no throttling of its own — it's behind
    // JwtAuthGuard + RolesGuard like every other admin route.
    ThrottlerModule.forRoot([{ ttl: 600_000, limit: 5 }]),
  ],
  controllers: [LeadsController, AdminLeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
