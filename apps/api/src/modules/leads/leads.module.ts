import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { Lead } from '../../database/control-plane/entities/lead.entity';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead]),
    // Scoped here rather than in AppModule: this is the only route in
    // the whole API an unauthenticated caller can flood, so it's the
    // only place a rate limiter needs to exist.
    ThrottlerModule.forRoot([{ ttl: 600_000, limit: 5 }]),
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
