import { createZodDto } from 'nestjs-zod';
import { updateGlassSchema } from '@repo/types/lookups';

export class UpdateGlassDto extends createZodDto(updateGlassSchema) {}
