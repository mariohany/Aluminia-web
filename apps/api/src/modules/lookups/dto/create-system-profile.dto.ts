import { createZodDto } from 'nestjs-zod';
import { createSystemProfileSchema } from '@repo/types/lookups';

export class CreateSystemProfileDto extends createZodDto(
  createSystemProfileSchema,
) {}
