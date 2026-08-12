import { createZodDto } from 'nestjs-zod';
import { createCompanyGlassCombinationSchema } from '@repo/types/company-lookups';

export class CreateCompanyGlassCombinationDto extends createZodDto(
  createCompanyGlassCombinationSchema,
) {}
