import { createZodDto } from 'nestjs-zod';
import { updateColorPriceSchema } from '@repo/types/lookups';

export class UpdateColorPriceDto extends createZodDto(updateColorPriceSchema) {}
