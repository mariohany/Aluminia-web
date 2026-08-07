import { createZodDto } from 'nestjs-zod';
import { createColorBrandSchema } from '@repo/types/lookups';

export class CreateColorBrandDto extends createZodDto(createColorBrandSchema) {}
