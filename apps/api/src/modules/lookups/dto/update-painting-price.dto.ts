import { createZodDto } from 'nestjs-zod';
import { updatePaintingPriceSchema } from '@repo/types/lookups';

export class UpdatePaintingPriceDto extends createZodDto(
  updatePaintingPriceSchema,
) {}
