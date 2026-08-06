import { createZodDto } from 'nestjs-zod';
import { createCompanySchema } from '@repo/types/companies';

export class CreateCompanyDto extends createZodDto(createCompanySchema) {}
