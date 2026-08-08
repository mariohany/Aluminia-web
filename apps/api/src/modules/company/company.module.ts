import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../database/control-plane/entities/company.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { CompanyController } from './company.controller';
import { CompanyUsersController } from './company-users.controller';
import { CompanyService } from './company.service';

// Imports UsersModule rather than re-deriving anything: the seat-limit
// transaction lives there and must have exactly one implementation.
@Module({
  imports: [TypeOrmModule.forFeature([Company, User]), UsersModule],
  controllers: [CompanyController, CompanyUsersController],
  providers: [CompanyService],
})
export class CompanyModule {}
