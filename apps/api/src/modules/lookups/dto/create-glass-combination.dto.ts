import { createZodDto } from 'nestjs-zod';
import { createGlassCombinationSchema } from '@repo/types/lookups';

export class CreateGlassCombinationDto extends createZodDto(
  createGlassCombinationSchema,
) {}
