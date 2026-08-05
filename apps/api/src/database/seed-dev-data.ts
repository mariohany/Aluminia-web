import { NestFactory } from '@nestjs/core';
import { UserRole } from '@repo/types/auth';
import { AppModule } from '../app.module';
import { TenantProvisioningService } from '../modules/tenancy/tenant-provisioning.service';
import { PasswordService } from '../modules/auth/password.service';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User, UserStatus } from './control-plane/entities/user.entity';

/**
 * Local development seed: one super admin plus TWO fully-provisioned
 * companies, each with its own admin.
 *
 * Two companies specifically, not one — Phase 6's whole job is proving
 * that tenant A cannot see tenant B's data, and you cannot test isolation
 * with a single tenant. Each schema gets distinguishable `tenant_info`
 * data as a side effect of provisioning.
 *
 * Idempotent: skips anything that already exists, so it's safe to re-run.
 *
 *   npm run seed:dev
 */
const SUPER_ADMIN = { email: 'admin@aluminia.local', password: 'ChangeMe123!' };

const COMPANIES = [
  {
    name: 'Cairo Aluminium Works',
    plan: 'starter',
    maxUsers: 5,
    admin: { email: 'admin@cairo-alu.local', password: 'ChangeMe123!' },
  },
  {
    name: 'Delta Window Systems',
    plan: 'starter',
    maxUsers: 3,
    admin: { email: 'admin@delta-windows.local', password: 'ChangeMe123!' },
  },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get<DataSource>(getDataSourceToken());
    const provisioning = app.get(TenantProvisioningService);
    const passwords = app.get(PasswordService);
    const users = dataSource.getRepository(User);

    const existingSuperAdmin = await users.findOne({
      where: { email: SUPER_ADMIN.email },
    });
    if (existingSuperAdmin) {
      console.log(`• super admin ${SUPER_ADMIN.email} already exists`);
    } else {
      await users.save(
        users.create({
          email: SUPER_ADMIN.email,
          passwordHash: await passwords.hash(SUPER_ADMIN.password),
          role: UserRole.SUPER_ADMIN,
          companyId: null,
          status: UserStatus.ACTIVE,
        }),
      );
      console.log(`✔ created super admin ${SUPER_ADMIN.email}`);
    }

    for (const company of COMPANIES) {
      const existing = await users.findOne({
        where: { email: company.admin.email },
      });
      if (existing) {
        console.log(`• ${company.name} already provisioned`);
        continue;
      }

      const { company: created } = await provisioning.provision(company);
      console.log(
        `✔ provisioned ${created.name} → schema "${created.schemaName}" (admin: ${company.admin.email})`,
      );
    }

    console.log(
      '\nSeed complete. Passwords are all "ChangeMe123!" — local development only.',
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
