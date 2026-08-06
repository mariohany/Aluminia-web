import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@repo/types/auth';
import type { CompanyDetail, CompanySummary } from '@repo/types/companies';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/jwt-payload';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { DeleteCompanyDto } from './dto/delete-company.dto';

@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(): Promise<CompanySummary[]> {
    return this.companies.list();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<CompanyDetail> {
    return this.companies.detail(id);
  }

  @Post()
  create(
    @Body() dto: CreateCompanyDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<CompanySummary> {
    return this.companies.create(dto, actor.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<CompanySummary> {
    return this.companies.update(id, dto, actor.id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<CompanySummary> {
    return this.companies.archive(id, actor.id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<CompanySummary> {
    return this.companies.reactivate(id, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteCompanyDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.companies.remove(id, dto.confirmName, actor.id);
  }
}
