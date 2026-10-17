import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../database/control-plane/entities/company.entity';
import { User } from '../../database/control-plane/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FilesModule } from '../files/files.module';
import { CompanyController } from './company.controller';
import { CompanyUsersController } from './company-users.controller';
import { CompanyProfileController } from './company-profile.controller';
import { CompanyService } from './company.service';
import { CompanyProfileService } from './company-profile.service';

// Imports UsersModule rather than re-deriving anything: the seat-limit
// transaction lives there and must have exactly one implementation.
// TenancyModule + FilesModule are for the company profile (tenant row +
// its logo file).
@Module({
  imports: [
    TypeOrmModule.forFeature([Company, User]),
    UsersModule,
    TenancyModule,
    FilesModule,
  ],
  controllers: [
    CompanyController,
    CompanyUsersController,
    CompanyProfileController,
  ],
  providers: [CompanyService, CompanyProfileService],
})
export class CompanyModule {}
