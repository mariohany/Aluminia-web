import { createZodDto } from 'nestjs-zod';
import { createPaintingPriceSchema } from '@repo/types/lookups';

export class CreatePaintingPriceDto extends createZodDto(
  createPaintingPriceSchema,
) {}
