import { createZodDto } from 'nestjs-zod';
import {
  bulkCreateSchema,
  createSystemCatalogSchema,
} from '@repo/types/lookups';

export class BulkDuplicateSystemCatalogsDto extends createZodDto(
  bulkCreateSchema(createSystemCatalogSchema),
) {}
