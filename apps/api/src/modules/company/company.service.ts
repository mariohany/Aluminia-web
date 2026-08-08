import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CompanyOverview } from '@repo/types/users';
import { Company } from '../../database/control-plane/entities/company.entity';
import { User } from '../../database/control-plane/entities/user.entity';

/**
 * The caller's own company, as the workspace needs to see it.
 *
 * Control-plane data, so nothing here is tenant-scoped: `companies` and
 * `users` live in the shared schema. The isolation that matters on this
 * surface is that `companyId` always arrives from the verified JWT.
 */
@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async overview(companyId: string): Promise<CompanyOverview> {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found.');

    // Read-only, so a plain count is fine — unlike the seat check in
    // UsersService, which counts inside a transaction holding a row
    // lock precisely because it is about to act on the result. This
    // number is for display; that one is enforcement.
    const seatsUsed = await this.users.count({ where: { companyId } });

    return {
      id: company.id,
      name: company.name,
      plan: company.plan,
      seatsUsed,
      maxUsers: company.maxUsers,
    };
  }
}
