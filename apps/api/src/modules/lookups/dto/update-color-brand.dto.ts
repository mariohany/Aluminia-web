import { createZodDto } from 'nestjs-zod';
import { updateColorBrandSchema } from '@repo/types/lookups';

export class UpdateColorBrandDto extends createZodDto(updateColorBrandSchema) {}
