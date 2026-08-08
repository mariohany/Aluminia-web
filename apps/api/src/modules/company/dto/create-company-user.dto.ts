import { createZodDto } from 'nestjs-zod';
import { createCompanyUserSchema } from '@repo/types/users';

export class CreateCompanyUserDto extends createZodDto(createCompanyUserSchema) {}
