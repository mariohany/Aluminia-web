import { createZodDto } from 'nestjs-zod';
import { createUserSchema } from '@repo/types/users';

export class CreateUserDto extends createZodDto(createUserSchema) {}
