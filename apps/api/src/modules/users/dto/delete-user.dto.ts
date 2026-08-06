import { createZodDto } from 'nestjs-zod';
import { deleteUserSchema } from '@repo/types/users';

export class DeleteUserDto extends createZodDto(deleteUserSchema) {}
