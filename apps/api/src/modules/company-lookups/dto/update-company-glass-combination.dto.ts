import { createZodDto } from 'nestjs-zod';
import { updateCompanyGlassCombinationSchema } from '@repo/types/company-lookups';

export class UpdateCompanyGlassCombinationDto extends createZodDto(
  updateCompanyGlassCombinationSchema,
) {}
