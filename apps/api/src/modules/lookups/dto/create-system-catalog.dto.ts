import { createZodDto } from 'nestjs-zod';
import { createSystemCatalogSchema } from '@repo/types/lookups';

export class CreateSystemCatalogDto extends createZodDto(
  createSystemCatalogSchema,
) {}
