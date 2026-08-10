import { createZodDto } from 'nestjs-zod';
import { bulkCreateSchema, createGlassSchema } from '@repo/types/lookups';

export class BulkDuplicateGlassDto extends createZodDto(
  bulkCreateSchema(createGlassSchema),
) {}
