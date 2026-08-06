import { createZodDto } from 'nestjs-zod';
import { updateUserSchema } from '@repo/types/users';

export class UpdateUserDto extends createZodDto(updateUserSchema) {}
