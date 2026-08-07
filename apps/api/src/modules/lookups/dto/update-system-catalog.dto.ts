import { createZodDto } from 'nestjs-zod';
import { updateSystemCatalogSchema } from '@repo/types/lookups';

export class UpdateSystemCatalogDto extends createZodDto(
  updateSystemCatalogSchema,
) {}
