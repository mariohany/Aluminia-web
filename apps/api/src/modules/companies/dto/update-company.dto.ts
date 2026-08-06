import { createZodDto } from 'nestjs-zod';
import { updateCompanySchema } from '@repo/types/companies';

export class UpdateCompanyDto extends createZodDto(updateCompanySchema) {}
