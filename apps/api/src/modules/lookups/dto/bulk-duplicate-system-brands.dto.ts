import { createZodDto } from 'nestjs-zod';
import { bulkCreateSchema, createSystemBrandSchema } from '@repo/types/lookups';

export class BulkDuplicateSystemBrandsDto extends createZodDto(
  bulkCreateSchema(createSystemBrandSchema),
) {}
