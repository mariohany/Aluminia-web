import { createZodDto } from 'nestjs-zod';
import { createProjectSchema } from '@repo/types/projects';

export class CreateProjectDto extends createZodDto(createProjectSchema) {}
