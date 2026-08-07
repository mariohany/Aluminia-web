import { createZodDto } from 'nestjs-zod';
import { updateGlassCombinationSchema } from '@repo/types/lookups';

export class UpdateGlassCombinationDto extends createZodDto(
  updateGlassCombinationSchema,
) {}
