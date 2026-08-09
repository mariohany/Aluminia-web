import { createZodDto } from 'nestjs-zod';
import { deleteLeadsSchema } from '@repo/types/leads';

export class DeleteLeadsDto extends createZodDto(deleteLeadsSchema) {}
