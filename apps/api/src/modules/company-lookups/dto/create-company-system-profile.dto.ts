import { createZodDto } from 'nestjs-zod';
import { createCompanySystemProfileSchema } from '@repo/types/company-lookups';

export class CreateCompanySystemProfileDto extends createZodDto(
  createCompanySystemProfileSchema,
) {}
