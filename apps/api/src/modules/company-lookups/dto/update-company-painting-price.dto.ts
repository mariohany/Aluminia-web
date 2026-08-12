import { createZodDto } from 'nestjs-zod';
import { updateCompanyPaintingPriceSchema } from '@repo/types/company-lookups';

export class UpdateCompanyPaintingPriceDto extends createZodDto(
  updateCompanyPaintingPriceSchema,
) {}
