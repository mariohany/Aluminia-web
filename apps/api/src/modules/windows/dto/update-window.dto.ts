import { createZodDto } from 'nestjs-zod';
import { updateWindowSchema } from '@repo/types/windows';

export class UpdateWindowDto extends createZodDto(updateWindowSchema) {}
