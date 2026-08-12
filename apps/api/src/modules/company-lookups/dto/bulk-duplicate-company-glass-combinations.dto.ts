import { createZodDto } from 'nestjs-zod';
import { bulkCreateSchema } from '@repo/types/lookups';
import { looseCompanyGlassCombinationSchema } from '@repo/types/company-lookups';

export class BulkDuplicateCompanyGlassCombinationsDto extends createZodDto(
  bulkCreateSchema(looseCompanyGlassCombinationSchema),
) {}
