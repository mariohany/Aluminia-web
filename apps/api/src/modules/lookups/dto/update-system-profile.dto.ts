import { createZodDto } from 'nestjs-zod';
import { updateSystemProfileSchema } from '@repo/types/lookups';

export class UpdateSystemProfileDto extends createZodDto(
  updateSystemProfileSchema,
) {}
