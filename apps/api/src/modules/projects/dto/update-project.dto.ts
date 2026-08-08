import { createZodDto } from 'nestjs-zod';
import { updateProjectSchema } from '@repo/types/projects';

export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
