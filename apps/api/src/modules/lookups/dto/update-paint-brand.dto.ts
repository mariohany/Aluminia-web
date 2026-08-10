import { createZodDto } from 'nestjs-zod';
import { updatePaintBrandSchema } from '@repo/types/lookups';

export class UpdatePaintBrandDto extends createZodDto(updatePaintBrandSchema) {}
