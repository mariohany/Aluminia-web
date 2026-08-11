import { createZodDto } from 'nestjs-zod';
import { companiesPerMonthQuerySchema } from '@repo/types/dashboard';

export class CompaniesPerMonthQueryDto extends createZodDto(
  companiesPerMonthQuerySchema,
) {}
