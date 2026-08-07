import { createZodDto } from 'nestjs-zod';
import { createSystemBrandSchema } from '@repo/types/lookups';

export class CreateSystemBrandDto extends createZodDto(
  createSystemBrandSchema,
) {}
