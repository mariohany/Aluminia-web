import { createZodDto } from 'nestjs-zod';
import { bulkIdsSchema } from '@repo/types/lookups';

export class BulkIdsDto extends createZodDto(bulkIdsSchema) {}
