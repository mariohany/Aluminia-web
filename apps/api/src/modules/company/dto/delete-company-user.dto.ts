import { createZodDto } from 'nestjs-zod';
import { deleteUserSchema } from '@repo/types/users';

export class DeleteCompanyUserDto extends createZodDto(deleteUserSchema) {}
