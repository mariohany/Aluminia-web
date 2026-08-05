import * as argon2 from 'argon2';
import { UserRole } from '@repo/types/auth';
import dataSource from './data-source';
import { User, UserStatus } from './entities/user.entity';

// One-off local/ops script — there's no signup and no admin UI yet, so
// this is the only way to create the first account. Usage:
//   npm run seed:super-admin -- <email> <password>
async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run seed:super-admin -- <email> <password>');
    process.exit(1);
  }

  await dataSource.initialize();
  const users = dataSource.getRepository(User);

  const existing = await users.findOne({ where: { email } });
  if (existing) {
    console.log(
      `A user with email "${email}" already exists (id: ${existing.id}). Not modifying it.`,
    );
    await dataSource.destroy();
    return;
  }

  const passwordHash = await argon2.hash(password);
  const user = await users.save(
    users.create({
      email,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      companyId: null,
      status: UserStatus.ACTIVE,
    }),
  );

  console.log(`Created super admin "${user.email}" (id: ${user.id}).`);
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('Failed to seed super admin:', err);
  process.exit(1);
});
