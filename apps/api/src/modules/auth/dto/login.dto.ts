import { createZodDto } from 'nestjs-zod';
import { loginRequestSchema } from '@repo/types/auth';

export class LoginDto extends createZodDto(loginRequestSchema) {}
