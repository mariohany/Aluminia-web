import { Body, Controller, Get, Patch } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { UserRole } from '@repo/types/auth';
import {
  updateCompanyProfileSchema,
  type CompanyProfile,
} from '@repo/types/company-profile';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { CompanyProfileService } from './company-profile.service';

class UpdateCompanyProfileDto extends createZodDto(
  updateCompanyProfileSchema,
) {}

/**
 * Config › Company profile (docs/company_profile_planing.md §4). Every
 * company user can read it (reports and quotes print it, P6); only a
 * company admin changes it. The logo itself is a `POST /files` upload
 * whose id is sent here as `logoFileId`.
 */
@Roles(UserRole.COMPANY_ADMIN, UserRole.USER)
@TenantScoped()
@Controller('company/profile')
export class CompanyProfileController {
  constructor(private readonly profile: CompanyProfileService) {}

  @Get()
  get(): Promise<CompanyProfile> {
    return this.profile.get();
  }

  @Patch()
  @Roles(UserRole.COMPANY_ADMIN)
  update(@Body() dto: UpdateCompanyProfileDto): Promise<CompanyProfile> {
    return this.profile.update(dto);
  }
}
