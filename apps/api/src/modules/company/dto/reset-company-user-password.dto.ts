import { createZodDto } from 'nestjs-zod';
import { resetUserPasswordSchema } from '@repo/types/users';

export class ResetCompanyUserPasswordDto extends createZodDto(resetUserPasswordSchema) {}
