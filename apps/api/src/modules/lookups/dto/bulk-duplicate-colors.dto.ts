import { createZodDto } from 'nestjs-zod';
import { bulkCreateSchema, createColorSchema } from '@repo/types/lookups';

export class BulkDuplicateColorsDto extends createZodDto(
  bulkCreateSchema(createColorSchema),
) {}
