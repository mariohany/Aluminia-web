import { createZodDto } from 'nestjs-zod';
import { createColorPriceSchema } from '@repo/types/lookups';

export class CreateColorPriceDto extends createZodDto(createColorPriceSchema) {}
