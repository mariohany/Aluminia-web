import { createZodDto } from 'nestjs-zod';
import { bulkCreateSchema } from '@repo/types/lookups';
import { createCompanySystemCatalogSchema } from '@repo/types/company-lookups';

export class BulkDuplicateCompanySystemCatalogsDto extends createZodDto(
  bulkCreateSchema(createCompanySystemCatalogSchema),
) {}
