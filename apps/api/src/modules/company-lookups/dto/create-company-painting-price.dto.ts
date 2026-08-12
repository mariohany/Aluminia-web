import { createZodDto } from 'nestjs-zod';
import { createCompanyPaintingPriceSchema } from '@repo/types/company-lookups';

export class CreateCompanyPaintingPriceDto extends createZodDto(
  createCompanyPaintingPriceSchema,
) {}
