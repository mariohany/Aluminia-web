import { createZodDto } from 'nestjs-zod';
import { resetUserPasswordSchema } from '@repo/types/users';

export class ResetUserPasswordDto extends createZodDto(resetUserPasswordSchema) {}
