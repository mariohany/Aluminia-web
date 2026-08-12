import { createZodDto } from 'nestjs-zod';
import { bulkCreateSchema } from '@repo/types/lookups';
import { createCompanySystemProfileSchema } from '@repo/types/company-lookups';

export class BulkDuplicateCompanySystemProfilesDto extends createZodDto(
  bulkCreateSchema(createCompanySystemProfileSchema),
) {}
