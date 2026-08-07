import { createZodDto } from 'nestjs-zod';
import { updateColorSchema } from '@repo/types/lookups';

export class UpdateColorDto extends createZodDto(updateColorSchema) {}
