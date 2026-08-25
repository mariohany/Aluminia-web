import { createZodDto } from 'nestjs-zod';
import { createWindowSchema } from '@repo/types/windows';

export class CreateWindowDto extends createZodDto(createWindowSchema) {}
