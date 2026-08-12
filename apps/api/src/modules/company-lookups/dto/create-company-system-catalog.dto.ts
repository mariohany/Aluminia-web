import { createZodDto } from 'nestjs-zod';
import { createCompanySystemCatalogSchema } from '@repo/types/company-lookups';

export class CreateCompanySystemCatalogDto extends createZodDto(
  createCompanySystemCatalogSchema,
) {}
