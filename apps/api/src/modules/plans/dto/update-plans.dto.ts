import { createZodDto } from 'nestjs-zod';
import { updatePlansSchema } from '@repo/types/plans';

export class UpdatePlansDto extends createZodDto(updatePlansSchema) {}
