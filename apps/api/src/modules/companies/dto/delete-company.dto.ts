import { createZodDto } from 'nestjs-zod';
import { deleteCompanySchema } from '@repo/types/companies';

export class DeleteCompanyDto extends createZodDto(deleteCompanySchema) {}
