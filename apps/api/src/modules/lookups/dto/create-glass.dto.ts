import { createZodDto } from 'nestjs-zod';
import { createGlassSchema } from '@repo/types/lookups';

export class CreateGlassDto extends createZodDto(createGlassSchema) {}
