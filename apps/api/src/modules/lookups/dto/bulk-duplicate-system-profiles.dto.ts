import { createZodDto } from 'nestjs-zod';
import {
  bulkCreateSchema,
  createSystemProfileSchema,
} from '@repo/types/lookups';

export class BulkDuplicateSystemProfilesDto extends createZodDto(
  bulkCreateSchema(createSystemProfileSchema),
) {}
