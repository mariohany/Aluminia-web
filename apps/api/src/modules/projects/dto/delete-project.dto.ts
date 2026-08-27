import { createZodDto } from 'nestjs-zod';
import { deleteProjectSchema } from '@repo/types/projects';

export class DeleteProjectDto extends createZodDto(deleteProjectSchema) {}
