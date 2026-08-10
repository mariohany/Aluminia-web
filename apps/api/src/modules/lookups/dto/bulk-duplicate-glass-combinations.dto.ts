import { createZodDto } from 'nestjs-zod';
import {
  bulkCreateSchema,
  looseGlassCombinationSchema,
} from '@repo/types/lookups';

export class BulkDuplicateGlassCombinationsDto extends createZodDto(
  bulkCreateSchema(looseGlassCombinationSchema),
) {}
