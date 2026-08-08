import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/control-plane/entities/user.entity';
import { Company } from '../../database/control-plane/entities/company.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Company, Session]), AuditLogModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  // Exported so CompanyModule's company-admin surface reuses this exact
  // service — above all its seat-limit transaction. A second
  // implementation of "is there a seat free?" is a second thing to get
  // right under concurrency.
  exports: [UsersService],
})
export class UsersModule {}
