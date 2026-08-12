import { createZodDto } from 'nestjs-zod';
import { updateCompanySystemProfileSchema } from '@repo/types/company-lookups';

export class UpdateCompanySystemProfileDto extends createZodDto(
  updateCompanySystemProfileSchema,
) {}
