import { createZodDto } from 'nestjs-zod';
import { updateSystemBrandSchema } from '@repo/types/lookups';

export class UpdateSystemBrandDto extends createZodDto(
  updateSystemBrandSchema,
) {}
