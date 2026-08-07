import { createZodDto } from 'nestjs-zod';
import { createColorSchema } from '@repo/types/lookups';

export class CreateColorDto extends createZodDto(createColorSchema) {}
