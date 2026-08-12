import { createZodDto } from 'nestjs-zod';
import { updateCompanySystemCatalogSchema } from '@repo/types/company-lookups';

export class UpdateCompanySystemCatalogDto extends createZodDto(
  updateCompanySystemCatalogSchema,
) {}
