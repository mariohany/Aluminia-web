import { createZodDto } from 'nestjs-zod';
import { createPaintBrandSchema } from '@repo/types/lookups';

export class CreatePaintBrandDto extends createZodDto(createPaintBrandSchema) {}
